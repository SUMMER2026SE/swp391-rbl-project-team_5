import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useAuth } from '../context/useAuth.js'
import { aiChat } from '../services/aiApi.js'

const WELCOME_MESSAGE =
  'Xin chào! Tôi là trợ lý VietTicket. Tôi có thể giúp bạn về chính sách đặt vé, hoàn vé, thanh toán. Bạn cần hỗ trợ gì?'

const INTERNAL_LINK_SPLIT_RE =
  /(\/(?:attractions|tickets|support|my-tickets|my-support)(?:\/[A-Za-z0-9-]+)?(?:\?[A-Za-z0-9_~!$&%()*+,;=:@/?-]*)?(?:#[A-Za-z0-9_~!$&%()*+,;=:@/?-]*)?)/g
const INTERNAL_LINK_RE =
  /^\/(?:attractions|tickets|support|my-tickets|my-support)(?:\/[A-Za-z0-9-]+)?(?:\?[A-Za-z0-9_~!$&%()*+,;=:@/?-]*)?(?:#[A-Za-z0-9_~!$&%()*+,;=:@/?-]*)?$/
const BOLD_TEXT_SPLIT_RE = /(\*\*[^*]+\*\*)/g
const LEGACY_CHAT_HISTORY_KEY = 'vietticket_chat_history'
const CHAT_HISTORY_KEY_PREFIX = 'vietticket_chat_history'
const MAX_CHAT_INPUT_LENGTH = 1200

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
  return [{ id: 'welcome', sender: 'bot', text: WELCOME_MESSAGE }]
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
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
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
        localStorage.setItem(storageKey, JSON.stringify(messages))
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

  const handleSend = useCallback(async () => {
    const trimmedInput = inputValue.trim()
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

    setMessages((current) => [...current, userMessage, loadingMessage])
    setInputValue('')
    setLoading(true)

    try {
      const result = await aiChat(trimmedInput, history.slice(-10))
      const reply = result.data?.reply ||
        'Xin lỗi, tôi chưa nhận được phản hồi. Vui lòng thử lại sau.'

      setMessages((current) =>
        current
          .filter((message) => message.id !== loadingMessage.id)
          .concat({ id: `bot-${Date.now()}`, sender: 'bot', text: reply }),
      )
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== loadingMessage.id))
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
        <div className="w-[92vw] sm:w-[400px] rounded-3xl border border-[#cbd5db] bg-white shadow-2xl">
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

          <div className="max-h-[60vh] sm:max-h-[500px] space-y-3 overflow-y-auto px-4 py-4 text-sm text-[#1f2933]">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[78%] rounded-3xl px-4 py-3 text-sm shadow-sm ${
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
                    renderMessageText(message.text)
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="rounded-b-3xl border-t border-[#cbd5db] bg-[#f8fafb] p-4">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                className="min-w-0 flex-1 rounded-2xl border border-[#cbd5db] bg-white px-4 py-3 text-sm text-[#1f2933] outline-none transition focus:border-[#00474d] focus:ring-2 focus:ring-[#00474d]/20"
                maxLength={MAX_CHAT_INPUT_LENGTH}
                placeholder="Nhập tin nhắn..."
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={handleKeyDown}
                type="text"
              />
              <button
                className="inline-flex h-12 items-center justify-center rounded-2xl bg-[#00474d] px-4 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-[0.98]"
                disabled={loading}
                onClick={handleSend}
                type="button"
              >
                Gửi
              </button>
            </div>
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
