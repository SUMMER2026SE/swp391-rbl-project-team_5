import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'react-toastify'
import { useAuth } from '../context/useAuth.js'
import { aiChat } from '../services/aiApi.js'

const WELCOME_MESSAGE =
  'Xin chào! Mình là Trợ lý VietTicket. Mình có thể giúp bạn tìm điểm đến, so sánh vé, giải đáp chính sách, kiểm tra đơn đã đăng nhập và trả lời các câu hỏi du lịch. Bạn muốn bắt đầu từ đâu?'

const INTERNAL_LINK_SPLIT_RE =
  /(\/(?:(?:attractions|tickets|support|my-tickets|my-support)(?:\/[A-Za-z0-9-]+)?|about|faq|terms|privacy|login|partner\/register)(?:\?[A-Za-z0-9_~!$&%()*+,;=:@/?-]*)?(?:#[A-Za-z0-9_~!$&%()*+,;=:@/?-]*)?)/g
const INTERNAL_LINK_RE =
  /^\/(?:(?:attractions|tickets|support|my-tickets|my-support)(?:\/[A-Za-z0-9-]+)?|about|faq|terms|privacy|login|partner\/register)(?:\?[A-Za-z0-9_~!$&%()*+,;=:@/?-]*)?(?:#[A-Za-z0-9_~!$&%()*+,;=:@/?-]*)?$/
const BOLD_TEXT_SPLIT_RE = /(\*\*[^*]+\*\*)/g
const LEGACY_CHAT_HISTORY_KEY = 'vietticket_chat_history'
const CHAT_HISTORY_KEY_PREFIX = 'vietticket_chat_history'
const MAX_CHAT_INPUT_LENGTH = 1200
const MAX_STORED_CHAT_MESSAGES = 20
const CHAT_HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_SUGGESTIONS = [
  'Gợi ý điểm tham quan ở Đà Nẵng',
  'Chính sách hoàn vé thế nào?',
  'Tôi nhận vé QR khi nào?',
]
const CONFIDENCE_LABELS = {
  verified: 'Đã kiểm tra dữ liệu VietTicket',
  grounded: 'Theo chính sách VietTicket',
  general: 'Thông tin tham khảo từ AI',
}

function renderPlainText(part, keyPrefix) {
  return String(part || '')
    .split(BOLD_TEXT_SPLIT_RE)
    .filter((segment) => segment.length > 0)
    .map((segment, index) =>
      segment.startsWith('**') && segment.endsWith('**') ? (
        <strong key={`${keyPrefix}-bold-${index}`}>{segment.slice(2, -2)}</strong>
      ) : (
        segment
      ),
    )
}

function renderInlineText(text) {
  return String(text || '')
    .split(INTERNAL_LINK_SPLIT_RE)
    .map((part, index) =>
      INTERNAL_LINK_RE.test(part) ? (
        <Link
          className="font-bold underline decoration-current underline-offset-2"
          key={`${part}-${index}`}
          to={part}
        >
          {part}
        </Link>
      ) : (
        renderPlainText(part, `text-${index}`)
      ),
    )
}

function renderMessageText(text) {
  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed">
      {renderInlineText(text)}
    </div>
  )
}

function getWelcomeMessages() {
  return [{
    id: 'welcome',
    sender: 'bot',
    text: WELCOME_MESSAGE,
    meta: { confidence: 'grounded', suggestions: DEFAULT_SUGGESTIONS },
  }]
}

function normalizeStoredMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter(
      (message) =>
        message
        && ['user', 'bot'].includes(message.sender)
        && typeof message.text === 'string'
        && !message.loading,
    )
    .slice(-MAX_STORED_CHAT_MESSAGES)
}

function getChatStorageKey(user) {
  const userId = user?.id || user?.userId
  return userId ? `${CHAT_HISTORY_KEY_PREFIX}_${userId}` : `${CHAT_HISTORY_KEY_PREFIX}_guest`
}

function readMessagesFromStorage(storageKey, { allowLegacy = false } = {}) {
  const storageKeys = [storageKey]
  if (allowLegacy && storageKey !== LEGACY_CHAT_HISTORY_KEY) {
    storageKeys.push(LEGACY_CHAT_HISTORY_KEY)
  }

  try {
    for (const key of storageKeys) {
      const saved = localStorage.getItem(key)
      if (!saved) continue

      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        const legacyMessages = normalizeStoredMessages(parsed)
        if (legacyMessages.length > 0) return legacyMessages
      }
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.messages)) {
        if (Number(parsed.expiresAt) <= Date.now()) {
          localStorage.removeItem(key)
          continue
        }
        const storedMessages = normalizeStoredMessages(parsed.messages)
        if (storedMessages.length > 0) return storedMessages
      }
    }
  } catch (error) {
    console.error('Failed to load chat history:', error)
  }

  return getWelcomeMessages()
}

function ChatbotWidgetSession({ allowLegacyHistory, storageKey }) {
  const inputRef = useRef(null)
  const messagesEndRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState(() =>
    readMessagesFromStorage(storageKey, { allowLegacy: allowLegacyHistory }),
  )
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            version: 2,
            expiresAt: Date.now() + CHAT_HISTORY_TTL_MS,
            messages: normalizeStoredMessages(messages),
          }),
        )
      } catch (error) {
        console.error('Failed to save chat history:', error)
      }
    }
  }, [messages, storageKey])

  useEffect(() => {
    if (!open) return

    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      messagesEndRef.current?.scrollIntoView({ block: 'end' })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [open])

  useEffect(() => {
    if (!open) return

    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, open])

  const history = useMemo(
    () =>
      messages
        .filter((message) => message.sender === 'user' || message.sender === 'bot')
        .slice(-20)
        .map((message) => ({
          role: message.sender === 'user' ? 'user' : 'assistant',
          content: message.text,
        })),
    [messages],
  )

  const activeSuggestions = useMemo(() => {
    const latestBotMessage = [...messages]
      .reverse()
      .find((message) => message.sender === 'bot' && !message.loading)
    const suggestions = latestBotMessage?.meta?.suggestions
    return Array.isArray(suggestions) && suggestions.length > 0
      ? suggestions.slice(0, 3)
      : DEFAULT_SUGGESTIONS
  }, [messages])

  const handleSend = useCallback(async (messageOverride = '') => {
    const trimmedInput = String(messageOverride || inputValue).trim()
    if (!trimmedInput || loading) return
    if (trimmedInput.length > MAX_CHAT_INPUT_LENGTH) {
      toast.warning('Nội dung chat quá dài. Vui lòng rút gọn câu hỏi.')
      return
    }

    const userMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: trimmedInput,
    }

    const loadingMessage = {
      id: `loading-${Date.now()}`,
      sender: 'bot',
      text: '...',
      loading: true,
    }

    setMessages((current) =>
      [...current, userMessage, loadingMessage].slice(-(MAX_STORED_CHAT_MESSAGES + 1)),
    )
    setInputValue('')
    setLoading(true)

    try {
      const result = await aiChat(trimmedInput, history.slice(-10))
      const reply = result.data?.reply ||
        'Xin lỗi, tôi chưa nhận được phản hồi. Vui lòng thử lại sau.'
      const meta = result.data?.meta || {}

      setMessages((current) =>
        current
          .filter((message) => message.id !== loadingMessage.id)
          .concat({ id: `bot-${Date.now()}`, sender: 'bot', text: reply, meta })
          .slice(-MAX_STORED_CHAT_MESSAGES),
      )
    } catch (error) {
      setMessages((current) =>
        current
          .filter((message) => message.id !== loadingMessage.id)
          .concat({
            id: `bot-error-${Date.now()}`,
            sender: 'bot',
            text: 'Mình đang gặp lỗi kết nối. Bạn có thể thử lại hoặc mở /support nếu cần hỗ trợ gấp.',
            meta: {
              confidence: 'grounded',
              suggestions: ['Thử lại câu hỏi vừa rồi', 'Cách tạo Support Ticket'],
            },
          })
          .slice(-MAX_STORED_CHAT_MESSAGES),
      )
      toast.error(error?.status === 400 && error.message
        ? error.message
        : 'Trợ lý tạm thời không khả dụng, vui lòng thử lại sau.')
    } finally {
      setLoading(false)
    }
  }, [history, inputValue, loading])

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const handleClearHistory = useCallback(() => {
    try {
      localStorage.removeItem(storageKey)
      if (allowLegacyHistory) {
        localStorage.removeItem(LEGACY_CHAT_HISTORY_KEY)
      }
      setMessages(getWelcomeMessages())
      toast.success('Đã xóa lịch sử chat')
    } catch (error) {
      console.error('Failed to clear chat history:', error)
      toast.error('Xóa lịch sử thất bại')
    }
  }, [allowLegacyHistory, storageKey])

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="flex h-[min(640px,calc(100vh-6.5rem))] w-[92vw] flex-col overflow-hidden rounded-3xl border border-[#cbd5db] bg-white shadow-2xl sm:w-[400px]">
          <div className="flex items-center justify-between rounded-t-3xl bg-[#00474d] px-4 py-3 text-white">
            <div>
              <h2 className="text-sm font-bold">Trợ lý VietTicket</h2>
              <p className="text-xs text-[#d1e8ee]">Hỗ trợ nhanh các câu hỏi du lịch</p>
            </div>
            <div className="flex gap-1">
              <button
                aria-label="Xóa lịch sử chat"
                className="rounded-full bg-white/10 px-2 py-1 text-sm hover:bg-white/20 transition"
                onClick={handleClearHistory}
                title="Xóa lịch sử"
                type="button"
              >
                <span className="material-symbols-outlined text-base">delete</span>
              </button>
              <button
                aria-label="Đóng chat"
                className="rounded-full bg-white/10 px-2 py-1 text-sm hover:bg-white/20"
                onClick={() => setOpen(false)}
                type="button"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </div>

          <div
            aria-live="polite"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm text-[#1f2933]"
            role="log"
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[84%] rounded-3xl px-4 py-3 text-sm shadow-sm ${
                    message.sender === 'user'
                      ? 'bg-[#00474d] text-white'
                      : 'bg-[#f3f6f7] text-[#1f2933]'
                  }`}
                >
                  {message.loading ? (
                    <div className="flex items-center gap-1 text-lg">
                      <span className="animate-pulse">.</span>
                      <span className="animate-pulse delay-100">.</span>
                      <span className="animate-pulse delay-200">.</span>
                    </div>
                  ) : (
                    <>
                      {renderMessageText(message.text)}
                      {message.sender === 'bot' && message.meta?.confidence && (
                        <div className="mt-3 border-t border-[#dbe4e7] pt-2">
                          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#5b6f75]">
                            <span className="material-symbols-outlined text-[14px]">
                              {message.meta.confidence === 'verified' ? 'verified' : 'info'}
                            </span>
                            {CONFIDENCE_LABELS[message.meta.confidence] || CONFIDENCE_LABELS.general}
                          </p>
                          {message.meta.currentInformationWarning && (
                            <p className="mt-1 text-[11px] leading-4 text-[#7a5b12]">
                              Thông tin này có thể thay đổi theo thời gian; hãy kiểm tra nguồn chính thức trước khi quyết định.
                            </p>
                          )}
                          {Array.isArray(message.meta.sources) && message.meta.sources.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {message.meta.sources
                                .filter((source) => INTERNAL_LINK_RE.test(source?.href || ''))
                                .map((source) => (
                                  <Link
                                    className="rounded-full border border-[#bdd0d4] bg-white px-2 py-1 text-[10px] font-semibold text-[#00474d] hover:border-[#00474d]"
                                    key={`${message.id}-${source.id}`}
                                    to={source.href}
                                  >
                                    {source.label}
                                  </Link>
                                ))}
                            </div>
                          )}
                          {Array.isArray(message.meta.actions) && message.meta.actions.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {message.meta.actions
                                .filter((action) => INTERNAL_LINK_RE.test(action?.href || ''))
                                .map((action) => (
                                  <Link
                                    className="rounded-xl bg-[#00474d] px-3 py-2 text-[11px] font-bold text-white hover:bg-[#00629d]"
                                    key={`${message.id}-${action.href}`}
                                    to={action.href}
                                  >
                                    {action.label}
                                  </Link>
                                ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="rounded-b-3xl border-t border-[#cbd5db] bg-[#f8fafb] p-4">
            {!loading && activeSuggestions.length > 0 && (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label="Câu hỏi gợi ý">
                {activeSuggestions.map((suggestion) => (
                  <button
                    className="shrink-0 rounded-full border border-[#9fb8bd] bg-white px-3 py-2 text-left text-[11px] font-semibold text-[#00474d] transition hover:border-[#00474d] hover:bg-[#eef7f7]"
                    key={suggestion}
                    onClick={() => handleSend(suggestion)}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                aria-describedby="chatbot-privacy-note"
                aria-label="Tin nhắn cho Trợ lý VietTicket"
                className="max-h-28 min-h-12 min-w-0 flex-1 resize-none rounded-2xl border border-[#cbd5db] bg-white px-4 py-3 text-sm text-[#1f2933] outline-none transition focus:border-[#00474d] focus:ring-2 focus:ring-[#00474d]/20"
                maxLength={MAX_CHAT_INPUT_LENGTH}
                placeholder="Hỏi bất cứ điều gì..."
                rows={1}
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                className="inline-flex h-12 items-center justify-center rounded-2xl bg-[#00474d] px-4 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-[0.98]"
                disabled={loading}
                onClick={() => handleSend()}
                type="button"
              >
                <span className="material-symbols-outlined">send</span>
                <span className="sr-only">Gửi</span>
              </button>
            </div>
            <p id="chatbot-privacy-note" className="mt-2 text-[11px] leading-4 text-[#64748b]">
              Không nhập mật khẩu, số thẻ, mã QR hoặc ảnh giấy tờ. Hệ thống tự che một số dữ liệu
              nhạy cảm trước khi gửi yêu cầu tới nhà cung cấp AI.
            </p>
          </div>
        </div>
      )}

      <button
        className="flex h-14 w-14 items-center justify-center rounded-full bg-[#00474d] text-white shadow-lg transition hover:bg-[#00629d] active:scale-95"
        onClick={() => setOpen((current) => !current)}
        type="button"
        aria-label="Mở trợ lý VietTicket"
      >
        <span className="material-symbols-outlined text-2xl">smart_toy</span>
      </button>
    </div>
  )
}

function ChatbotWidget() {
  const { user } = useAuth()
  const userId = user?.id || user?.userId || ''
  const storageKey = getChatStorageKey(user)

  return (
    <ChatbotWidgetSession
      allowLegacyHistory={!userId}
      key={storageKey}
      storageKey={storageKey}
    />
  )
}

export default ChatbotWidget
