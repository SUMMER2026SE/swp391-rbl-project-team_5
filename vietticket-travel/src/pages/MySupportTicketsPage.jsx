import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import Header from '../components/Header.jsx'
import { useAuth } from '../context/useAuth.js'
import useSocket from '../context/useSocket.js'
import supportApi from '../services/supportApi.js'

const STATUS_META = {
  OPEN: { label: 'Chờ xử lý', className: 'bg-surface-container-high text-on-surface-variant' },
  IN_PROGRESS: { label: 'Đang xử lý', className: 'bg-blue-100 text-blue-700' },
  RESOLVED: { label: 'Đã xử lý', className: 'bg-green-100 text-green-700' },
}

const formatTime = (value) =>
  new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.OPEN
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${meta.className}`}>
      {meta.label}
    </span>
  )
}

function MySupportTicketsPage() {
  const { user } = useAuth()
  const socket = useSocket()
  const [tickets, setTickets] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const messagesEndRef = useRef(null)

  const loadTickets = useCallback(async () => {
    try {
      const data = await supportApi.getMyTickets()
      setTickets(data)
      setActiveId((current) => current || data[0]?.id || null)
    } catch (error) {
      toast.error(error.message)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTickets(), 0)
    return () => window.clearTimeout(timer)
  }, [loadTickets])

  // Tải chi tiết + tham gia phòng chat khi chọn ticket.
  useEffect(() => {
    if (!activeId) return undefined
    let active = true

    supportApi
      .getTicketDetail(activeId)
      .then((data) => {
        if (active) setDetail(data)
      })
      .catch((error) => toast.error(error.message))

    socket.emit('JOIN_SUPPORT_TICKET', activeId)
    return () => {
      active = false
      socket.emit('LEAVE_SUPPORT_TICKET', activeId)
    }
  }, [activeId, socket])

  // Lắng nghe tin nhắn + đổi trạng thái real-time.
  useEffect(() => {
    function handleMessage(message) {
      if (message.ticketId !== activeId) return
      setDetail((current) =>
        current ? { ...current, messages: [...current.messages, message] } : current,
      )
    }
    function handleStatus(payload) {
      if (payload.ticketId === activeId) {
        setDetail((current) => (current ? { ...current, status: payload.status } : current))
      }
      setTickets((current) =>
        current.map((t) =>
          t.id === payload.ticketId ? { ...t, status: payload.status } : t,
        ),
      )
    }

    socket.on('SUPPORT_MESSAGE', handleMessage)
    socket.on('SUPPORT_TICKET_UPDATED', handleStatus)
    return () => {
      socket.off('SUPPORT_MESSAGE', handleMessage)
      socket.off('SUPPORT_TICKET_UPDATED', handleStatus)
    }
  }, [socket, activeId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [detail?.messages?.length])

  async function handleSend() {
    const text = draft.trim()
    if (!text || isSending) return

    setIsSending(true)
    try {
      await supportApi.sendTicketMessage(activeId, text)
      setDraft('')
      // Tin của mình hiển thị qua broadcast SUPPORT_MESSAGE (nhận lại từ socket).
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSending(false)
    }
  }

  const isResolved = detail?.status === 'RESOLVED'

  return (
    <>
      <Header activeLink="Support" />
      <div className="mx-auto flex h-[calc(100vh-80px)] max-w-[1440px] bg-surface">
        {/* Danh sách ticket */}
        <aside className="flex w-full max-w-xs shrink-0 flex-col border-r border-outline-variant/30 bg-surface-container-lowest md:w-80">
          <div className="flex items-center justify-between border-b border-outline-variant/30 p-4">
            <h2 className="text-lg font-bold text-primary">Yêu cầu của tôi</h2>
            <Link
              to="/support"
              className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-on-primary"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              Tạo mới
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tickets.length === 0 ? (
              <p className="p-6 text-center text-sm text-on-surface-variant">
                Bạn chưa có yêu cầu hỗ trợ nào.
              </p>
            ) : (
              tickets.map((ticket) => {
                const last = ticket.messages?.[0]
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => setActiveId(ticket.id)}
                    className={`flex w-full flex-col gap-1 border-b border-outline-variant/20 p-4 text-left transition ${
                      activeId === ticket.id
                        ? 'bg-primary/5'
                        : 'hover:bg-surface-container-high'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold text-on-surface">
                        {ticket.subject}
                      </span>
                      <StatusBadge status={ticket.status} />
                    </div>
                    {last && (
                      <span className="truncate text-xs text-on-surface-variant">
                        {last.message}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {/* Khung chat */}
        <main className="flex min-w-0 flex-1 flex-col">
          {!detail ? (
            <div className="flex flex-1 items-center justify-center text-on-surface-variant">
              Chọn một yêu cầu để xem hội thoại.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-outline-variant/30 bg-surface-container-lowest p-4">
                <div className="min-w-0">
                  <h3 className="truncate font-bold text-on-surface">{detail.subject}</h3>
                  {detail.bookingId && (
                    <Link
                      to={`/tickets/${detail.bookingId}`}
                      target="_blank"
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      Xem vé điện tử liên quan
                    </Link>
                  )}
                </div>
                <StatusBadge status={detail.status} />
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto bg-surface-container-low/40 p-4">
                {detail.messages.map((message) => {
                  const mine = message.senderId === user?.id
                  return (
                    <div
                      key={message.id}
                      className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                          mine
                            ? 'bg-primary text-on-primary'
                            : 'bg-surface-container-high text-on-surface'
                        }`}
                      >
                        {message.message}
                      </div>
                      <span className="mt-1 text-[11px] text-on-surface-variant">
                        {message.senderName || (mine ? 'Bạn' : 'Hỗ trợ')} ·{' '}
                        {formatTime(message.createdAt)}
                      </span>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>

              {isResolved ? (
                <div className="border-t border-outline-variant/30 bg-surface-container-lowest p-4 text-center text-sm text-on-surface-variant">
                  Yêu cầu này đã được giải quyết và đóng lại. Vui lòng tạo yêu cầu mới nếu
                  bạn cần hỗ trợ thêm.
                </div>
              ) : (
                <div className="flex items-end gap-2 border-t border-outline-variant/30 bg-surface-container-lowest p-4">
                  <textarea
                    className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-outline-variant bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    placeholder="Nhập tin nhắn... (Enter để gửi)"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void handleSend()
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={isSending || !draft.trim()}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-on-primary transition hover:brightness-110 disabled:opacity-50"
                    aria-label="Gửi"
                  >
                    <span className="material-symbols-outlined">send</span>
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </>
  )
}

export default MySupportTicketsPage
