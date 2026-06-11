import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import useSocket from '../../context/useSocket.js'
import supportApi from '../../services/supportApi.js'

const FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'OPEN', label: 'Chờ xử lý' },
  { value: 'IN_PROGRESS', label: 'Đang xử lý' },
  { value: 'RESOLVED', label: 'Đã xong' },
]

const STATUS_META = {
  OPEN: { label: 'Chờ xử lý', className: 'bg-surface-container-high text-on-surface-variant' },
  IN_PROGRESS: { label: 'Đang xử lý', className: 'bg-blue-100 text-blue-700' },
  RESOLVED: { label: 'Đã xong', className: 'bg-green-100 text-green-700' },
}

const formatTime = (value) =>
  new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })

function formatAge(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} phút`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} giờ`
  return `${Math.floor(hrs / 24)} ngày`
}
function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.OPEN
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${meta.className}`}>
      {meta.label}
    </span>
  )
}

export default function SupportTicketsPage() {
  const socket = useSocket()
  const [tickets, setTickets] = useState([])
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const messagesEndRef = useRef(null)

  const loadTickets = useCallback(async () => {
    try {
      const data = await supportApi.getAllTickets({ status: filter, search })
      setTickets(data)
    } catch (error) {
      toast.error(error.message)
    }
  }, [filter, search])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTickets(), 300)
    return () => window.clearTimeout(timer)
  }, [loadTickets])

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
        current.map((t) => (t.id === payload.ticketId ? { ...t, status: payload.status } : t)),
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
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSending(false)
    }
  }

  async function handleResolve() {
    try {
      await supportApi.updateTicketStatus(activeId, 'RESOLVED')
      toast.success('Đã đánh dấu yêu cầu là đã giải quyết.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  async function handleClaim() {
    try {
      await supportApi.updateTicketStatus(activeId, 'IN_PROGRESS')
      toast.success('Đã nhận xử lý ticket.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  const isResolved = detail?.status === 'RESOLVED'
  const isOpen = detail?.status === 'OPEN'
  const customer = detail?.user

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm ticket...">
      <div className="flex h-[calc(100vh-64px)] overflow-hidden">
        {/* Hàng đợi ticket */}
        <section className="flex w-72 shrink-0 flex-col border-r border-outline-variant bg-surface-container-lowest xl:w-80">
          <div className="border-b border-outline-variant p-4">
            <h2 className="mb-3 text-lg font-bold text-on-surface">Hỗ trợ khách hàng</h2>
            <div className="relative mb-3">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">
                search
              </span>
              <input
                className="w-full rounded-full border border-outline-variant bg-surface py-2 pl-10 pr-4 text-sm outline-none focus:border-primary"
                type="search"
                placeholder="Tìm mã ticket, khách hàng..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    filter === f.value
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-high text-on-surface-variant'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tickets.length === 0 ? (
              <p className="p-6 text-center text-sm text-on-surface-variant">
                Không có yêu cầu nào.
              </p>
            ) : (
              tickets.map((ticket) => {
                  const last = ticket.messages?.[0]
                  const age = ticket.createdAt ? formatAge(ticket.createdAt) : ''
                  return (
                    <button
                      key={ticket.id}
                      type="button"
                      onClick={() => setActiveId(ticket.id)}
                      className={`flex w-full flex-col gap-1 border-b border-outline-variant/20 p-4 text-left transition ${
                        activeId === ticket.id ? 'bg-primary/5' : 'hover:bg-surface-container-high'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-on-surface">
                          {ticket.subject}
                        </span>
                        <StatusBadge status={ticket.status} />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-on-surface-variant">
                          {ticket.user?.fullName || 'Khách'} · {last?.message || ''}
                        </span>
                        {ticket.status === 'OPEN' && (
                          <span className="shrink-0 rounded-full bg-error/10 px-2 py-0.5 text-[10px] font-bold text-error">
                            {age}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })
            )}
          </div>
        </section>

        {/* Khung hội thoại */}
        <section className="flex min-w-0 flex-1 flex-col">
          {!detail ? (
            <div className="flex flex-1 items-center justify-center text-on-surface-variant">
              Chọn một yêu cầu để bắt đầu hỗ trợ.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-outline-variant bg-surface px-5 py-4">
                <div className="min-w-0">
                  <h3 className="truncate font-bold text-on-surface">{detail.subject}</h3>
                  <p className="text-xs text-on-surface-variant">
                    {customer?.fullName} · {customer?.email}
                  </p>
                </div>
                <StatusBadge status={detail.status} />
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto bg-surface-container-low/40 p-4">
                {detail.messages.map((message) => {
                  const fromCustomer = message.senderId === detail.userId
                  return (
                    <div
                      key={message.id}
                      className={`flex flex-col ${fromCustomer ? 'items-start' : 'items-end'}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                          fromCustomer
                            ? 'bg-surface-container-high text-on-surface'
                            : 'bg-primary text-on-primary'
                        }`}
                      >
                        {message.message}
                      </div>
                      <span className="mt-1 text-[11px] text-on-surface-variant">
                        {message.senderName || (fromCustomer ? 'Khách' : 'Bạn')} ·{' '}
                        {formatTime(message.createdAt)}
                      </span>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>

              {isResolved ? (
                <div className="border-t border-outline-variant bg-surface px-5 py-4 text-center text-sm text-on-surface-variant">
                  Yêu cầu đã được đóng.
                </div>
              ) : (
                <div className="flex items-end gap-2 border-t border-outline-variant bg-surface px-5 py-4">
                  <textarea
                    className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-outline-variant bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
                    placeholder="Nhập phản hồi... (Enter để gửi)"
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
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-on-primary disabled:opacity-50"
                    aria-label="Gửi"
                  >
                    <span className="material-symbols-outlined">send</span>
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Bảng thông tin khách */}
        {detail && (
          <aside className="hidden w-72 shrink-0 flex-col border-l border-outline-variant bg-surface-container-lowest p-5 2xl:flex">
            <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-on-surface-variant">
              Thông tin khách hàng
            </h3>
            <div className="space-y-3 text-sm">
              <InfoRow icon="person" label="Họ tên" value={customer?.fullName} />
              <InfoRow icon="mail" label="Email" value={customer?.email} />
              <InfoRow
                icon="call"
                label="Điện thoại"
                value={customer?.profile?.phoneNumber || 'Chưa cập nhật'}
              />
            </div>
            <div className="mt-6 flex flex-col gap-3">
              {isOpen && (
                <button
                  type="button"
                  onClick={() => void handleClaim()}
                  className="flex items-center justify-center gap-2 rounded-xl border border-primary bg-primary/5 px-4 py-3 text-sm font-semibold text-primary transition hover:bg-primary/10"
                >
                  <span className="material-symbols-outlined text-[20px]">person_raised_hand</span>
                  Nhận xử lý
                </button>
              )}
              {!isResolved && (
                <button
                  type="button"
                  onClick={() => void handleResolve()}
                  className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-on-primary transition hover:opacity-90"
                >
                  <span className="material-symbols-outlined text-[20px]">task_alt</span>
                  Đánh dấu đã giải quyết
                </button>
              )}
            </div>
          </aside>
        )}
      </div>
    </AdminLayout>
  )
}

function InfoRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="material-symbols-outlined text-[20px] text-primary">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-on-surface-variant">{label}</p>
        <p className="truncate font-semibold text-on-surface">{value || 'Chưa cập nhật'}</p>
      </div>
    </div>
  )
}
