import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import useSocket from '../../context/useSocket.js'
import supportApi from '../../services/supportApi.js'
import { useAuth } from '../../context/useAuth.js'

const FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'OPEN', label: 'Chờ xử lý' },
  { value: 'IN_PROGRESS', label: 'Đang xử lý' },
  { value: 'RESOLVED', label: 'Đã xong' },
]

const PRIORITIES = [
  { value: '', label: 'Mọi mức độ' },
  { value: 'URGENT', label: 'Khẩn cấp' },
  { value: 'HIGH', label: 'Cao' },
  { value: 'NORMAL', label: 'Bình thường' },
  { value: 'LOW', label: 'Thấp' },
]

const PRIORITY_META = {
  URGENT: { label: 'Khẩn cấp', className: 'bg-red-100 text-red-700' },
  HIGH: { label: 'Cao', className: 'bg-orange-100 text-orange-700' },
  NORMAL: { label: 'Bình thường', className: 'bg-blue-50 text-blue-700' },
  LOW: { label: 'Thấp', className: 'bg-slate-100 text-slate-600' },
}

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

const isSameId = (left, right) => String(left ?? '') === String(right ?? '')

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.OPEN
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${meta.className}`}>
      {meta.label}
    </span>
  )
}

function PriorityBadge({ priority }) {
  const meta = PRIORITY_META[priority] || PRIORITY_META.NORMAL
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.className}`}>
      {meta.label}
    </span>
  )
}

export default function SupportTicketsPage() {
  const socket = useSocket()
  const { user } = useAuth()
  const [tickets, setTickets] = useState([])
  const [filter, setFilter] = useState('')
  const [priority, setPriority] = useState('')
  const [assignment, setAssignment] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 1,
  })
  const [stats, setStats] = useState({ OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0 })
  const [activeId, setActiveId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showResolve, setShowResolve] = useState(false)
  const [resolutionCode, setResolutionCode] = useState('RESOLVED_INFORMATION')
  const [resolutionNote, setResolutionNote] = useState('')
  const messagesEndRef = useRef(null)

  const loadTickets = useCallback(async () => {
    try {
      const result = await supportApi.getAllTickets({
        status: filter,
        search,
        priority,
        assignment,
        page,
      })
      setTickets(result.data)
      setPagination(result.pagination)
      setStats(result.stats)
    } catch (error) {
      toast.error(error.message)
    }
  }, [assignment, filter, page, priority, search])

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
      if (!isSameId(message.ticketId, activeId)) return
      setDetail((current) =>
        current ? { ...current, messages: [...current.messages, message] } : current,
      )
    }
    function handleStatus(payload) {
      if (isSameId(payload.ticketId, activeId)) {
        setDetail((current) => (current ? { ...current, status: payload.status } : current))
      }
      setTickets((current) =>
        current.map((t) => (isSameId(t.id, payload.ticketId) ? { ...t, status: payload.status } : t)),
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
      if (!detail?.assignedToId) {
        const updated = await supportApi.getTicketDetail(activeId)
        setDetail(updated)
        void loadTickets()
      }
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSending(false)
    }
  }

  async function handleResolve() {
    const note = resolutionNote.trim()
    if (note.length < 10) {
      toast.warning('Vui lòng nhập kết luận xử lý tối thiểu 10 ký tự.')
      return
    }
    try {
      const updated = await supportApi.updateTicketStatus(activeId, 'RESOLVED', {
        resolutionCode,
        resolutionNote: note,
      })
      setDetail((current) => (current ? { ...current, ...updated } : current))
      setShowResolve(false)
      setResolutionNote('')
      toast.success('Đã đánh dấu yêu cầu là đã giải quyết.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  async function handleClaim() {
    try {
      const updated = await supportApi.updateTicketStatus(activeId, 'IN_PROGRESS')
      setDetail((current) => (current ? { ...current, ...updated } : current))
      void loadTickets()
      toast.success('Đã nhận xử lý ticket.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  const isResolved = detail?.status === 'RESOLVED'
  const isOpen = detail?.status === 'OPEN'
  const assignedToMe = detail?.assignedToId === user?.id
  const customer = detail?.user

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm ticket...">
      <div className="flex h-[calc(100dvh-64px)] min-h-[calc(100dvh-64px)] overflow-hidden">
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
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => {
                    setFilter(f.value)
                    setPage(1)
                  }}
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
            <div className="mt-3 grid grid-cols-2 gap-2">
              <select
                value={priority}
                onChange={(event) => {
                  setPriority(event.target.value)
                  setPage(1)
                }}
                className="min-w-0 rounded-lg border border-outline-variant bg-surface px-2 py-1.5 text-xs"
                aria-label="Lọc theo mức độ ưu tiên"
              >
                {PRIORITIES.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <select
                value={assignment}
                onChange={(event) => {
                  setAssignment(event.target.value)
                  setPage(1)
                }}
                className="min-w-0 rounded-lg border border-outline-variant bg-surface px-2 py-1.5 text-xs"
                aria-label="Lọc theo người phụ trách"
              >
                <option value="">Mọi phân công</option>
                <option value="MINE">Của tôi</option>
                <option value="UNASSIGNED">Chưa nhận</option>
              </select>
            </div>
            <p className="mt-2 text-[11px] text-on-surface-variant">
              Chờ {stats.OPEN || 0} · Đang xử lý {stats.IN_PROGRESS || 0} · Đã xong {stats.RESOLVED || 0}
            </p>
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
                        isSameId(activeId, ticket.id) ? 'bg-primary/5' : 'hover:bg-surface-container-high'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-on-surface">
                          {ticket.subject}
                        </span>
                        <StatusBadge status={ticket.status} />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <PriorityBadge priority={ticket.priority} />
                        <span className="truncate text-[10px] text-on-surface-variant">
                          {ticket.assignedTo?.fullName || 'Chưa phân công'}
                        </span>
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
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-outline-variant px-3 py-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded-lg border border-outline-variant px-2 py-1 text-xs font-semibold disabled:opacity-40"
              >
                Trước
              </button>
              <span className="text-xs text-on-surface-variant">
                {pagination.page}/{pagination.totalPages} · {pagination.total} ticket
              </span>
              <button
                type="button"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
                className="rounded-lg border border-outline-variant px-2 py-1 text-xs font-semibold disabled:opacity-40"
              >
                Sau
              </button>
            </div>
          )}
        </section>

        {/* Khung hội thoại */}
        <section className="flex min-w-0 flex-1 flex-col">
          {!detail ? (
            <div className="flex flex-1 items-center justify-center text-on-surface-variant">
              Chọn một yêu cầu để bắt đầu hỗ trợ.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant bg-surface px-5 py-4">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-bold text-on-surface">{detail.subject}</h3>
                  <p className="text-xs text-on-surface-variant">
                    {customer?.fullName} · {customer?.email}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-primary">
                    {detail.assignedTo
                      ? `Phụ trách: ${detail.assignedTo.fullName}`
                      : 'Chưa có nhân viên phụ trách'}
                  </p>
                  <div className="mt-2">
                    <PriorityBadge priority={detail.priority} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isOpen && (
                    <button
                      type="button"
                      onClick={() => void handleClaim()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/10"
                    >
                      <span className="material-symbols-outlined text-[16px]">person_raised_hand</span>
                      Nhận xử lý
                    </button>
                  )}
                  {!isResolved && assignedToMe && (
                    <button
                      type="button"
                      onClick={() => {
                        setResolutionCode('RESOLVED_INFORMATION')
                        setResolutionNote('')
                        setShowResolve(true)
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition hover:opacity-90"
                    >
                      <span className="material-symbols-outlined text-[16px]">task_alt</span>
                      Giải quyết
                    </button>
                  )}
                  <StatusBadge status={detail.status} />
                </div>
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
                <div className="border-t border-outline-variant bg-surface px-5 py-4 text-sm text-on-surface-variant">
                  <p className="font-semibold text-on-surface">Yêu cầu đã được giải quyết.</p>
                  {detail.resolutionNote && (
                    <p className="mt-1 whitespace-pre-wrap">{detail.resolutionNote}</p>
                  )}
                </div>
              ) : (
                <div className="flex items-end gap-2 border-t border-outline-variant bg-surface px-5 py-4">
                  <textarea
                    className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-outline-variant bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
                    placeholder="Nhập phản hồi... (Enter để gửi)"
                    value={draft}
                    disabled={Boolean(detail.assignedToId && !assignedToMe)}
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
                    disabled={
                      isSending
                      || !draft.trim()
                      || Boolean(detail.assignedToId && !assignedToMe)
                    }
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
          </aside>
        )}
      </div>

      {showResolve && detail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowResolve(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="resolve-ticket-title"
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="resolve-ticket-title" className="text-xl font-bold text-on-surface">
              Kết luận yêu cầu hỗ trợ
            </h3>
            <p className="mt-2 text-sm text-on-surface-variant">
              Chỉ đóng ticket sau khi đã phản hồi khách và ghi rõ kết quả cuối cùng.
            </p>
            <label className="mt-5 block text-sm font-semibold text-on-surface">
              Kết quả xử lý
              <select
                value={resolutionCode}
                onChange={(event) => setResolutionCode(event.target.value)}
                className="mt-2 w-full rounded-xl border border-outline-variant px-3 py-2.5"
              >
                <option value="RESOLVED_INFORMATION">Đã cung cấp thông tin</option>
                <option value="REFUND_GUIDANCE">Đã hướng dẫn hoàn tiền</option>
                <option value="TECHNICAL_FIXED">Đã khắc phục lỗi kỹ thuật</option>
                <option value="PARTNER_FOLLOW_UP">Đã chuyển đối tác xử lý</option>
                <option value="OTHER">Kết quả khác</option>
              </select>
            </label>
            <label className="mt-4 block text-sm font-semibold text-on-surface">
              Kết luận chi tiết
              <textarea
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
                maxLength={2000}
                rows={5}
                placeholder="Nêu việc đã kiểm tra, hướng xử lý và thông tin đã phản hồi cho khách."
                className="mt-2 w-full resize-none rounded-xl border border-outline-variant px-3 py-2.5"
              />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowResolve(false)}
                className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={resolutionNote.trim().length < 10}
                onClick={() => void handleResolve()}
                className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary disabled:opacity-50"
              >
                Xác nhận giải quyết
              </button>
            </div>
          </div>
        </div>
      )}
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
