import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import { aiChat } from '../services/aiApi.js'

const WELCOME_MESSAGE =
  'Xin chào! Tôi là trợ lý VietTicket. Tôi có thể giúp bạn về chính sách đặt vé, hoàn vé, thanh toán. Bạn cần hỗ trợ gì?'

function ChatbotWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [inputValue, setInputValue] = useState('')
  const [loading, setLoading] = useState(false)

  // Load messages from localStorage on component mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('vietticket_chat_history')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed)
          return
        }
      }
    } catch (error) {
      console.error('Failed to load chat history:', error)
    }
    // Fallback to welcome message
    setMessages([{ id: 'welcome', sender: 'bot', text: WELCOME_MESSAGE }])
  }, [])

  // Save messages to localStorage whenever they change
  useEffect(() => {
    if (messages.length > 0) {
      try {
        localStorage.setItem('vietticket_chat_history', JSON.stringify(messages))
      } catch (error) {
        console.error('Failed to save chat history:', error)
      }
    }
  }, [messages])

  const history = useMemo(
    () =>
      messages
        .filter((message) => message.sender === 'user' || message.sender === 'bot')
        .slice(-20)
        .map((message) => ({
          role: message.sender === 'user' ? 'user' : 'assistant',
          message: message.text,
        })),
    [messages],
  )

  const handleSend = useCallback(async () => {
    const trimmedInput = inputValue.trim()
    if (!trimmedInput || loading) return

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
      toast.error('Trợ lý tạm thời không khả dụng, vui lòng thử lại sau.')
    } finally {
      setLoading(false)
    }
  }, [history, inputValue, loading])

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleSend()
    }
  }

  const handleClearHistory = useCallback(() => {
    try {
      localStorage.removeItem('vietticket_chat_history')
      setMessages([{ id: 'welcome', sender: 'bot', text: WELCOME_MESSAGE }])
      toast.success('Đã xóa lịch sử chat')
    } catch (error) {
      console.error('Failed to clear chat history:', error)
      toast.error('Xóa lịch sử thất bại')
    }
  }, [])

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-[400px] rounded-3xl border border-[#cbd5db] bg-white shadow-2xl">
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

          <div className="max-h-[500px] space-y-3 overflow-y-auto px-4 py-4 text-sm text-[#1f2933]">
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
                    message.text
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-b-3xl border-t border-[#cbd5db] bg-[#f8fafb] p-4">
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-2xl border border-[#cbd5db] bg-white px-4 py-3 text-sm text-[#1f2933] outline-none transition focus:border-[#00474d] focus:ring-2 focus:ring-[#00474d]/20"
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

export default ChatbotWidget
