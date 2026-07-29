import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import {
  formatBookingReference,
  formatRefundRequestReference,
} from '../../utils/bookingReference.js'
import {
  adjudicateRefundRequest,
  listRefundRequests,
  processRefundRequest,
  reconcileRefundRequest,
} from '../../services/staffApi.js'
import { useAuth } from '../../context/useAuth.js'
import { hasRole } from '../../utils/userRoles.js'

const STATUS_META = {
  PENDING: {
    label: 'Chờ xử lý',
    badge: 'bg-secondary-fixed text-on-secondary-fixed',
  },
  PROCESSING: {
    label: 'Đang xử lý',
    badge: 'bg-blue-100 text-blue-800',
  },
  APPROVED: {
    label: 'Đã hoàn',
    badge: 'bg-primary-fixed-dim/40 text-primary',
  },
  REJECTED: {
    label: 'Đã từ chối',
    badge: 'bg-error-container text-on-error-container',
  },
}

const REQUEST_TYPE_LABEL = {
  CUSTOMER_CANCELLATION: 'Khách yêu cầu hủy',
  PARTNER_CANCELLATION: 'Đối tác hủy',
  SYSTEM_CANCELLATION: 'Hệ thống hủy',
  DUPLICATE_PAYMENT: 'Thanh toán trùng',
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('vi-VN')} VND`
}

function formatDate(value) {
  if (!value) return 'Chưa cập nhật'
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value))
}

function formatDateTime(value) {
  if (!value) return 'Chưa cập nhật'
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(value))
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.PENDING
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-tight ${meta.badge}`}
    >
      {meta.label}
    </span>
  )
}

function StatCard({ icon, iconClass, label, value, badge }) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-5">
      <div className="mb-4 flex min-h-8 items-start justify-between">
        <span className={`material-symbols-outlined rounded-lg p-2 ${iconClass}`}>
          {icon}
        </span>
        {badge}
      </div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
        {label}
      </p>
      <h3 className="font-headline-md text-2xl font-semibold text-on-surface">{value}</h3>
    </div>
  )
}

function RefundDrawer({
  selected,
  isProcessing,
  isAdmin,
  onClose,
  onApprove,
  onReject,
  onReconcile,
  onManualAdjudicate,
}) {
  if (!selected) {
    return (
      <aside className="hidden w-[400px] shrink-0 border-l border-outline-variant bg-surface-container-lowest xl:flex xl:flex-col">
        <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
          <span className="material-symbols-outlined mb-4 text-5xl text-outline">
            receipt_long
          </span>
          <h3 className="mb-2 text-lg font-semibold text-on-surface">Chọn một yêu cầu</h3>
          <p className="text-sm text-on-surface-variant">
            Chi tiết hoàn tiền sẽ hiển thị tại đây.
          </p>
        </div>
      </aside>
    )
  }

  const booking = selected.booking || {}
  const reservation = booking.reservation || {}
  const ticketProduct = reservation.ticketProduct || {}
  const originalAmount = Number(selected.originalAmount ?? booking.totalAmount ?? 0)
  const refundAmount = Number(selected.amount || 0)
  const feeAmount = Number(
    selected.feeAmount ?? Math.max(0, originalAmount - refundAmount),
  )
  const feeRate = originalAmount > 0
    ? Math.round((feeAmount / originalAmount) * 100)
    : 0
  const isPending = selected.status === 'PENDING'
  const isReconciling = selected.status === 'PROCESSING'
  const latestTransaction = selected.refundTransactions?.[0]
  const canApprove = selected.processingEligibility?.canApprove !== false
  const approvalBlockReason = selected.processingEligibility?.blockReason
  const isManualBankTransfer =
    selected.processingEligibility?.mode === 'MANUAL_BANK_TRANSFER'

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[400px] flex-col border-l border-outline-variant bg-surface-container-lowest shadow-2xl xl:static xl:w-[400px] xl:shrink-0">
      <div className="flex items-center justify-between border-b border-outline-variant px-6 py-5">
        <h3 className="text-xl font-semibold text-on-surface">Chi tiết yêu cầu</h3>
        <button
          type="button"
          className="rounded-full border-0 bg-transparent p-1 hover:bg-surface-container-high"
          onClick={onClose}
          aria-label="Đóng chi tiết"
        >
          <span className="material-symbols-outlined text-on-surface-variant">close</span>
        </button>
      </div>

      <div className="flex-1 space-y-8 overflow-y-auto p-6">
        <div className="rounded-xl border border-outline-variant/50 bg-surface p-4">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-primary-fixed-dim/30">
              <span className="material-symbols-outlined text-[32px] text-primary">
                local_activity
              </span>
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-primary">
                  {formatBookingReference(booking.id)}
                </span>
                <StatusBadge status={selected.status} />
              </div>
              <h4 className="text-base font-semibold leading-tight text-on-surface">
                {ticketProduct.attraction?.title || 'Địa điểm chưa cập nhật'}
              </h4>
              <p className="mt-1 text-xs text-on-surface-variant">
                Ngày sử dụng: {formatDate(reservation.date)}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-y-6">
          <div>
            <p className="mb-1 text-xs uppercase text-on-surface-variant">Khách hàng</p>
            <p className="text-sm font-semibold text-on-surface">
              {booking.user?.fullName || booking.fullName || 'Chưa cập nhật'}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase text-on-surface-variant">Loại vé</p>
            <p className="text-sm text-on-surface">
              {ticketProduct.name || ticketProduct.type || 'Chưa cập nhật'}
            </p>
          </div>
          <div className="col-span-2">
            <p className="mb-1 text-xs uppercase text-on-surface-variant">Loại yêu cầu</p>
            <p className="text-sm font-semibold text-on-surface">
              {REQUEST_TYPE_LABEL[selected.type] || selected.type || 'Yêu cầu hoàn tiền'}
              {selected.mandatory ? ' · Bắt buộc hoàn' : ''}
            </p>
          </div>
          <div className="col-span-2">
            <p className="mb-1 text-xs uppercase text-on-surface-variant">Lý do hoàn trả</p>
            <div className="rounded-lg border border-secondary-container/30 bg-secondary-container/10 p-3">
              <p className="text-sm italic text-on-surface-variant">
                &ldquo;{selected.reason || 'Khách hàng không cung cấp lý do.'}&rdquo;
              </p>
            </div>
          </div>
          {selected.staffNotes && (
            <div className="col-span-2">
              <p className="mb-1 text-xs uppercase text-on-surface-variant">Ghi chú xử lý</p>
              <p className="rounded-lg bg-surface-container-low p-3 text-sm text-on-surface">
                {selected.staffNotes}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <p className="text-xs uppercase text-on-surface-variant">Tính toán hoàn tiền</p>
          <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-on-surface-variant">Giá trị vé gốc</span>
              <span className="text-sm text-on-surface">{formatMoney(originalAmount)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-on-surface-variant">
                Phí xử lý ({feeRate}%)
              </span>
              <span className="text-sm text-error">- {formatMoney(feeAmount)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-outline-variant pt-3">
              <span className="text-sm font-bold text-on-surface">Thực nhận hoàn trả</span>
              <span className="text-lg font-bold text-primary">{formatMoney(refundAmount)}</span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase text-on-surface-variant">Thông tin yêu cầu</p>
          <div className="flex items-center gap-3 rounded-lg border border-outline-variant p-3">
            <span className="material-symbols-outlined text-primary">schedule</span>
            <div>
              <p className="text-sm font-semibold text-on-surface">
                Gửi lúc {formatDateTime(selected.createdAt)}
              </p>
              <p className="text-xs text-on-surface-variant">
                Mã yêu cầu: {formatRefundRequestReference(selected.id)}
              </p>
            </div>
          </div>
        </div>

        {latestTransaction && (
          <div className="space-y-2">
            <p className="text-xs uppercase text-on-surface-variant">Đối soát thanh toán</p>
            <div className="rounded-lg border border-outline-variant bg-surface-container-low p-3 text-sm text-on-surface">
              <p className="font-semibold">{latestTransaction.status}</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {latestTransaction.gateway || 'Cổng thanh toán'}:{' '}
                {latestTransaction.gatewayResponseCode || 'N/A'} / {latestTransaction.gatewayTransactionStatus || 'N/A'}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-outline-variant bg-surface-container p-6 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
        {isPending ? (
          <>
            {!canApprove && (
              <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-[20px]">warning</span>
                  <p>{approvalBlockReason}</p>
                </div>
              </div>
            )}
            <div className={`grid gap-3 ${selected.mandatory ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <button
                type="button"
                className="flex items-center justify-center gap-2 rounded-xl border-0 bg-primary px-4 py-3 text-sm font-semibold text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={onApprove}
                disabled={isProcessing || !canApprove}
              >
                <span className="material-symbols-outlined text-[20px]">check_circle</span>
                Thực hiện hoàn tiền
              </button>
              {!selected.mandatory && (
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 rounded-xl border border-error bg-white px-4 py-3 text-sm font-semibold text-error hover:bg-error/5 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onReject}
                  disabled={isProcessing}
                >
                  <span className="material-symbols-outlined text-[20px]">cancel</span>
                  Từ chối
                </button>
              )}
            </div>
            <p className="mt-4 text-center text-[11px] text-on-surface-variant">
              {isManualBankTransfer
                ? 'Nhân viên chỉ xác nhận sau khi đã chuyển khoản hoàn thực tế và có mã tham chiếu ngân hàng.'
                : selected.type === 'DUPLICATE_PAYMENT'
                ? 'Khoản hoàn này chỉ xử lý giao dịch thu trùng, không hủy booking hoặc vé hợp lệ.'
                : selected.type === 'CUSTOMER_CANCELLATION'
                  ? 'Booking và mã QR đã mất hiệu lực khi khách xác nhận hủy; bước này chỉ thực hiện hoặc đối soát khoản hoàn.'
                  : 'Booking đã được hủy theo nghiệp vụ; hệ thống đang hoàn lại toàn bộ khoản đã thu.'}
            </p>
          </>
        ) : isReconciling ? (
          <div className="space-y-3">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl border-0 bg-primary px-4 py-3 text-sm font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={onReconcile}
              disabled={isProcessing}
            >
              <span className="material-symbols-outlined text-[20px]">sync</span>
              {isProcessing
                ? 'Đang đối soát...'
                : isManualBankTransfer
                  ? 'Khôi phục ghi nhận hoàn chuyển khoản'
                  : 'Đối soát tự động với VNPay'}
            </button>
            {isAdmin && latestTransaction && (
              <>
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={onManualAdjudicate}
                  disabled={isProcessing}
                >
                  <span className="material-symbols-outlined text-[20px]">verified_user</span>
                  Phân xử bằng chứng thủ công
                </button>
                <p className="text-center text-[11px] leading-relaxed text-on-surface-variant">
                  Chỉ dùng khi đã kiểm tra cổng quản trị VNPay hoặc sao kê ngân hàng.
                  Mọi bằng chứng và người xác nhận đều được ghi nhật ký.
                </p>
              </>
            )}
          </div>
        ) : (
          <p className="text-center text-sm font-semibold text-on-surface-variant">
            Yêu cầu này đã được xử lý.
          </p>
        )}
      </div>
    </aside>
  )
}

const PAGE_SIZE = 20

export default function RefundManagementPage() {
  const { user } = useAuth()
  const isAdmin = hasRole(user, 'ADMIN')
  const [requests, setRequests] = useState([])
  const [selected, setSelected] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  // Thống kê theo trạng thái do server tính trên TOÀN BỘ dữ liệu -> không lệch
  // theo trang/bộ lọc hiện tại.
  const [stats, setStats] = useState({ total: 0, pending: 0, processing: 0, approved: 0, rejected: 0 })
  const [rejectModal, setRejectModal] = useState({ open: false, notes: '' })
  const [approveModal, setApproveModal] = useState({
    open: false,
    notes: '',
    manualReference: '',
  })
  const [adjudicateModal, setAdjudicateModal] = useState({
    open: false,
    outcome: 'SUCCESS',
    gatewayTransactionId: '',
    evidenceNote: '',
  })

  // Bộ đếm để bỏ qua response cũ đến muộn (tránh race khi đổi trang/gõ tìm kiếm
  // liên tục làm dữ liệu cũ ghi đè dữ liệu mới).
  const requestIdRef = useRef(0)

  // Phân trang phía server: chỉ tải đúng 1 trang mỗi lần thay vì toàn bộ danh sách.
  const fetchRequests = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setIsLoading(true)
    try {
      const response = await listRefundRequests({
        status: statusFilter || undefined,
        search: debouncedSearch || undefined,
        page,
        limit: PAGE_SIZE,
      })
      if (requestId !== requestIdRef.current) return // response cũ -> bỏ qua
      const nextRequests = response.data || []
      // Trang hiện tại rỗng (vd. vừa xử lý bản ghi cuối) nhưng chưa phải trang 1
      // -> lùi về trang trước; effect sẽ tự tải lại.
      if (nextRequests.length === 0 && page > 1) {
        setPage((p) => Math.max(1, p - 1))
        return
      }
      setRequests(nextRequests)
      if (response.stats) setStats(response.stats)
      if (response.pagination) {
        setTotalPages(response.pagination.totalPages || 1)
        setTotal(response.pagination.total || 0)
      }
      setSelected((current) => {
        if (!current) return nextRequests[0] || null
        return nextRequests.find((item) => item.id === current.id) || nextRequests[0] || null
      })
    } catch (error) {
      if (requestId !== requestIdRef.current) return // response cũ -> bỏ qua
      toast.error(error.message)
      setRequests([])
      setSelected(null)
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false)
    }
  }, [statusFilter, debouncedSearch, page])

  useEffect(() => {
    // Hoãn 1 tick để tránh gọi setState đồng bộ ngay trong thân effect.
    const timer = window.setTimeout(() => {
      void fetchRequests()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchRequests])

  // Debounce ô tìm kiếm 350ms -> không gọi API mỗi phím gõ. Quay về trang 1 để
  // không bị kẹt ở trang không tồn tại khi từ khóa thay đổi.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [search])

  const handleStatusFilterChange = (value) => {
    setStatusFilter(value)
    setPage(1)
  }

  async function handleApprove() {
    if (!selected) return
    if (selected.processingEligibility?.canApprove === false) {
      toast.error(selected.processingEligibility.blockReason)
      setApproveModal({ open: false, notes: '', manualReference: '' })
      return
    }
    const requiresManualReference =
      selected.processingEligibility?.requiresManualReference === true
    const manualReference = approveModal.manualReference.trim()
    if (requiresManualReference && !/^[A-Za-z0-9][A-Za-z0-9._/-]{5,99}$/.test(manualReference)) {
      toast.warning('Vui lòng nhập mã tham chiếu giao dịch hoàn tiền hợp lệ.')
      return
    }
    setIsProcessing(true)
    try {
      const response = await processRefundRequest(
        selected.id,
        'APPROVED',
        approveModal.notes.trim(),
        manualReference,
      )
      toast.success(
        response.data?.requiresReconciliation
          ? 'Khoản hoàn đã chuyển sang đối soát VNPay.'
          : 'Đã duyệt yêu cầu hoàn tiền.',
      )
      setApproveModal({ open: false, notes: '', manualReference: '' })
      setSelected(null)
      await fetchRequests()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsProcessing(false)
    }
  }

  async function handleReconcile() {
    if (!selected) return
    setIsProcessing(true)
    try {
      const response = await reconcileRefundRequest(selected.id)
      toast.success(response.message || 'Đã cập nhật kết quả đối soát.')
      setSelected(null)
      await fetchRequests()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsProcessing(false)
    }
  }

  function openManualAdjudication() {
    if (!selected || !isAdmin) return
    setAdjudicateModal({
      open: true,
      outcome: 'SUCCESS',
      gatewayTransactionId: selected.refundTransactions?.[0]?.gatewayTransactionId || '',
      evidenceNote: '',
    })
  }

  async function handleManualAdjudication() {
    if (!selected || !isAdmin) return
    const transaction = selected.refundTransactions?.[0]
    if (!transaction) {
      toast.error('Không tìm thấy giao dịch đang chờ đối soát.')
      return
    }
    const evidenceNote = adjudicateModal.evidenceNote.trim()
    const gatewayTransactionId = adjudicateModal.gatewayTransactionId.trim()
    if (evidenceNote.length < 10) {
      toast.warning('Vui lòng mô tả bằng chứng đã kiểm tra (ít nhất 10 ký tự).')
      return
    }
    if (adjudicateModal.outcome === 'SUCCESS' && !gatewayTransactionId) {
      toast.warning('Vui lòng nhập mã giao dịch hoàn VNPay.')
      return
    }
    const paymentTransactionRef = transaction.payment?.transactionId
    if (!transaction.transactionType || !paymentTransactionRef) {
      toast.error('Dữ liệu giao dịch chưa đủ để phân xử an toàn. Hãy tải lại trang.')
      return
    }

    setIsProcessing(true)
    try {
      const response = await adjudicateRefundRequest(selected.id, {
        outcome: adjudicateModal.outcome,
        confirmAmount: Number(transaction.amount ?? selected.amount),
        transactionType: transaction.transactionType,
        paymentTransactionRef,
        gatewayTransactionId: gatewayTransactionId || undefined,
        evidenceNote,
        gatewayResponseCode: adjudicateModal.outcome === 'SUCCESS' ? '00' : 'MANUAL_FAILED',
        gatewayTransactionStatus: adjudicateModal.outcome === 'SUCCESS' ? '00' : 'MANUAL_FAILED',
      })
      toast.success(response.message || 'Đã lưu kết quả phân xử thủ công.')
      setAdjudicateModal({
        open: false,
        outcome: 'SUCCESS',
        gatewayTransactionId: '',
        evidenceNote: '',
      })
      setSelected(null)
      await fetchRequests()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsProcessing(false)
    }
  }

  async function handleReject() {
    if (!selected) return
    const notes = rejectModal.notes.trim()
    if (!notes) {
      toast.warning('Vui lòng nhập lý do từ chối.')
      return
    }
    setIsProcessing(true)
    try {
      await processRefundRequest(selected.id, 'REJECTED', notes)
      toast.success('Đã từ chối yêu cầu hoàn tiền.')
      setRejectModal({ open: false, notes: '' })
      setSelected(null)
      await fetchRequests()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsProcessing(false)
    }
  }

  // Server đã lọc + phân trang sẵn nên bảng hiển thị trực tiếp danh sách trả về.
  const filtered = requests

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm hoàn tiền...">
      <div className="flex overflow-hidden" style={{ height: 'calc(100vh - 64px)' }}>
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-8">
            <div className="mb-8">
              <h2 className="mb-1 text-3xl font-semibold text-on-surface">
                Quản lý Hoàn tiền
              </h2>
              <p className="text-sm text-on-surface-variant">
                Thực hiện và đối soát các khoản hoàn của booking đã hủy
              </p>
            </div>

            <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-5">
              <StatCard
                icon="sync"
                iconClass="bg-blue-100 text-blue-800"
                label="Đang xử lý"
                value={stats.processing}
              />
              <StatCard
                icon="analytics"
                iconClass="bg-primary-fixed-dim/20 text-primary"
                label="Tổng yêu cầu"
                value={stats.total}
              />
              <StatCard
                icon="pending_actions"
                iconClass="bg-secondary-fixed/30 text-secondary"
                label="Chờ duyệt"
                value={stats.pending}
                badge={
                  stats.pending > 0 ? (
                    <span className="rounded bg-secondary-fixed/30 px-2 py-1 text-xs font-bold text-secondary">
                      Cần xử lý
                    </span>
                  ) : null
                }
              />
              <StatCard
                icon="check_circle"
                iconClass="bg-primary-fixed-dim/20 text-primary-container"
                label="Đã duyệt"
                value={stats.approved}
              />
              <StatCard
                icon="cancel"
                iconClass="bg-error-container/40 text-error"
                label="Đã từ chối"
                value={stats.rejected}
              />
            </div>

            <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
              <div className="flex flex-col gap-4 border-b border-outline-variant bg-surface-container-low px-6 py-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                  <h4 className="text-base font-semibold text-on-surface">
                    Danh sách yêu cầu
                  </h4>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary hover:opacity-90"
                    onClick={() => void fetchRequests()}
                  >
                    <span className="material-symbols-outlined text-[16px]">refresh</span>
                    Làm mới
                  </button>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">
                      search
                    </span>
                    <input
                      className="w-full rounded-full border border-outline-variant bg-surface py-2 pl-10 pr-4 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary sm:w-64"
                      type="search"
                      placeholder="Tìm booking, khách hàng..."
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </div>
                  <select
                    className="rounded-lg border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface outline-none focus:border-primary"
                    value={statusFilter}
                    onChange={(event) => handleStatusFilterChange(event.target.value)}
                    aria-label="Lọc theo trạng thái"
                  >
                    <option value="">Tất cả trạng thái</option>
                    <option value="PENDING">Chờ xử lý</option>
                    <option value="PROCESSING">Đang xử lý</option>
                    <option value="APPROVED">Đã hoàn</option>
                    <option value="REJECTED">Đã từ chối</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-left">
                  <thead>
                    <tr className="bg-surface-container-low/50">
                      {['Booking ID', 'Khách hàng', 'Địa điểm', 'Giá gốc', 'Hoàn tiền', 'Trạng thái'].map(
                        (heading) => (
                          <th
                            key={heading}
                            className={`border-b border-outline-variant px-6 py-3 text-sm font-semibold text-on-surface-variant ${
                              heading === 'Hoàn tiền' ? 'text-right' : ''
                            }`}
                          >
                            {heading}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant">
                    {isLoading ? (
                      Array.from({ length: 4 }, (_, index) => (
                        <tr key={index} className="animate-pulse">
                          {Array.from({ length: 6 }, (_, cell) => (
                            <td key={cell} className="px-6 py-5">
                              <div className="h-4 rounded bg-surface-container-high" />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : filtered.length ? (
                      filtered.map((request) => {
                        const booking = request.booking || {}
                        const attraction =
                          booking.reservation?.ticketProduct?.attraction?.title || 'Chưa cập nhật'
                        const isSelected = selected?.id === request.id
                        return (
                          <tr
                            key={request.id}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-primary-container/5 ring-1 ring-inset ring-primary/20'
                                : 'hover:bg-surface-container-high'
                            }`}
                            onClick={() => setSelected(request)}
                          >
                            <td className="px-6 py-4 text-sm font-bold text-primary">
                              {formatBookingReference(booking.id)}
                            </td>
                            <td className="px-6 py-4 text-sm text-on-surface">
                              {booking.user?.fullName || booking.fullName || 'Chưa cập nhật'}
                            </td>
                            <td className="max-w-52 truncate px-6 py-4 text-sm text-on-surface">
                              {attraction}
                            </td>
                            <td className="px-6 py-4 text-sm text-on-surface-variant">
                              {formatMoney(booking.totalAmount)}
                            </td>
                            <td className="px-6 py-4 text-right text-sm font-bold text-primary">
                              {formatMoney(request.amount)}
                            </td>
                            <td className="px-6 py-4">
                              <StatusBadge status={request.status} />
                            </td>
                          </tr>
                        )
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan="6"
                          className="px-6 py-16 text-center text-sm text-on-surface-variant"
                        >
                          Không tìm thấy yêu cầu hoàn tiền phù hợp.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t border-outline-variant bg-surface-container-low px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-on-surface-variant">
                  {total > 0
                    ? `Trang ${page}/${totalPages} • Tổng ${total.toLocaleString('vi-VN')} yêu cầu`
                    : 'Không có yêu cầu nào'}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg border border-outline-variant bg-surface px-3 py-1.5 text-sm font-semibold text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={isLoading || page <= 1}
                  >
                    <span className="material-symbols-outlined text-[18px]">chevron_left</span>
                    Trước
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg border border-outline-variant bg-surface px-3 py-1.5 text-sm font-semibold text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={isLoading || page >= totalPages}
                  >
                    Sau
                    <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <RefundDrawer
            selected={selected}
            isProcessing={isProcessing}
            isAdmin={isAdmin}
            onClose={() => setSelected(null)}
            onApprove={() => setApproveModal({ open: true, notes: '', manualReference: '' })}
            onReject={() => setRejectModal({ open: true, notes: '' })}
            onReconcile={() => void handleReconcile()}
            onManualAdjudicate={openManualAdjudication}
          />
        </div>
      </div>

      {adjudicateModal.open && selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isProcessing) {
              setAdjudicateModal({
                open: false,
                outcome: 'SUCCESS',
                gatewayTransactionId: '',
                evidenceNote: '',
              })
            }
          }}
        >
          <form
            className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-surface-container-lowest p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-adjudication-title"
            onSubmit={(event) => {
              event.preventDefault()
              void handleManualAdjudication()
            }}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
                  <span className="material-symbols-outlined text-[16px]">gpp_maybe</span>
                  Quyền quản trị · Có nhật ký
                </div>
                <h3 id="manual-adjudication-title" className="text-xl font-semibold text-on-surface">
                  Phân xử hoàn tiền bằng bằng chứng
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">
                  Chỉ xác nhận sau khi đối chiếu cổng quản trị VNPay hoặc sao kê ngân hàng.
                  Thao tác thành công sẽ cập nhật sổ tài chính và không thể hoàn tác.
                </p>
              </div>
              <button
                type="button"
                className="rounded-full border-0 bg-transparent p-1 hover:bg-surface-container-high"
                onClick={() => setAdjudicateModal({
                  open: false,
                  outcome: 'SUCCESS',
                  gatewayTransactionId: '',
                  evidenceNote: '',
                })}
                disabled={isProcessing}
                aria-label="Đóng"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="mb-5 grid gap-3 rounded-xl border border-outline-variant bg-surface-container-low p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-on-surface-variant">Booking</p>
                <p className="mt-1 text-sm font-bold text-primary">
                  {formatBookingReference(selected.booking?.id)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-on-surface-variant">Số tiền phải khớp</p>
                <p className="mt-1 text-sm font-bold text-on-surface">
                  {formatMoney(selected.refundTransactions?.[0]?.amount ?? selected.amount)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-on-surface-variant">Loại giao dịch</p>
                <p className="mt-1 text-sm font-semibold text-on-surface">
                  {selected.refundTransactions?.[0]?.transactionType === '02'
                    ? '02 · Hoàn toàn phần'
                    : '03 · Hoàn số tiền sau phí (một phần giao dịch)'}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-on-surface-variant">Mã thanh toán gốc</p>
                <p className="mt-1 break-all font-mono text-xs font-semibold text-on-surface">
                  {selected.refundTransactions?.[0]?.payment?.transactionId || 'Thiếu dữ liệu'}
                </p>
              </div>
            </div>

            <fieldset className="mb-5">
              <legend className="mb-2 text-sm font-semibold text-on-surface">Kết quả đã xác minh</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    value: 'SUCCESS',
                    title: 'Đã hoàn thành công',
                    description: 'Tiền đã được VNPay chấp nhận hoàn.',
                    icon: 'verified',
                  },
                  {
                    value: 'FAILED',
                    title: 'Chưa hoàn thành công',
                    description: 'Lần gửi trước thất bại; đưa lại hàng chờ.',
                    icon: 'restart_alt',
                  },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                      adjudicateModal.outcome === option.value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-outline-variant bg-surface hover:bg-surface-container-low'
                    }`}
                  >
                    <input
                      type="radio"
                      name="manual-refund-outcome"
                      className="sr-only"
                      value={option.value}
                      checked={adjudicateModal.outcome === option.value}
                      onChange={(event) => setAdjudicateModal((current) => ({
                        ...current,
                        outcome: event.target.value,
                      }))}
                      disabled={isProcessing}
                    />
                    <span className="flex items-start gap-3">
                      <span className="material-symbols-outlined text-primary">{option.icon}</span>
                      <span>
                        <span className="block text-sm font-bold text-on-surface">{option.title}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-on-surface-variant">
                          {option.description}
                        </span>
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label
              className="mb-2 block text-sm font-semibold text-on-surface"
              htmlFor="manual-refund-gateway-id"
            >
              Mã giao dịch hoàn VNPay
              {adjudicateModal.outcome === 'SUCCESS' && <span className="text-error"> *</span>}
            </label>
            <input
              id="manual-refund-gateway-id"
              className="mb-4 w-full rounded-xl border border-outline-variant bg-surface p-3 font-mono text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              placeholder="Ví dụ: 147258369"
              value={adjudicateModal.gatewayTransactionId}
              onChange={(event) => setAdjudicateModal((current) => ({
                ...current,
                gatewayTransactionId: event.target.value,
              }))}
              required={adjudicateModal.outcome === 'SUCCESS'}
              maxLength={120}
              disabled={isProcessing}
              autoFocus
            />

            <label
              className="mb-2 block text-sm font-semibold text-on-surface"
              htmlFor="manual-refund-evidence"
            >
              Bằng chứng đã đối chiếu <span className="text-error">*</span>
            </label>
            <textarea
              id="manual-refund-evidence"
              className="min-h-28 w-full resize-y rounded-xl border border-outline-variant bg-surface p-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              placeholder="Ghi rõ nguồn kiểm tra, thời điểm, người/đơn vị xác nhận và kết quả nhìn thấy..."
              value={adjudicateModal.evidenceNote}
              onChange={(event) => setAdjudicateModal((current) => ({
                ...current,
                evidenceNote: event.target.value,
              }))}
              minLength={10}
              maxLength={2000}
              required
              disabled={isProcessing}
            />

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                className="rounded-lg border border-outline-variant bg-white px-4 py-2.5 text-sm font-semibold text-on-surface"
                onClick={() => setAdjudicateModal({
                  open: false,
                  outcome: 'SUCCESS',
                  gatewayTransactionId: '',
                  evidenceNote: '',
                })}
                disabled={isProcessing}
              >
                Hủy
              </button>
              <button
                type="submit"
                className={`flex items-center justify-center gap-2 rounded-lg border-0 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                  adjudicateModal.outcome === 'SUCCESS' ? 'bg-primary' : 'bg-amber-700'
                }`}
                disabled={isProcessing}
              >
                <span className="material-symbols-outlined text-[18px]">
                  {adjudicateModal.outcome === 'SUCCESS' ? 'verified' : 'restart_alt'}
                </span>
                {isProcessing
                  ? 'Đang ghi nhận...'
                  : adjudicateModal.outcome === 'SUCCESS'
                    ? 'Xác nhận đã hoàn thành công'
                    : 'Xác nhận thất bại và mở lại'}
              </button>
            </div>
          </form>
        </div>
      )}

      {approveModal.open && selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isProcessing) {
              setApproveModal({ open: false, notes: '', manualReference: '' })
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="approve-refund-title"
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 id="approve-refund-title" className="text-xl font-semibold text-on-surface">
                  Xác nhận duyệt hoàn tiền
                </h3>
                <p className="mt-1 text-sm text-on-surface-variant">
                  Hành động này sẽ hoàn tiền cho khách và không thể hoàn tác.
                </p>
              </div>
              <button
                type="button"
                className="rounded-full border-0 bg-transparent p-1 hover:bg-surface-container-high"
                onClick={() => setApproveModal({ open: false, notes: '', manualReference: '' })}
                disabled={isProcessing}
                aria-label="Đóng"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {selected.processingEligibility?.requiresManualReference && (
              <>
                <label
                  className="mb-2 mt-4 block text-sm font-semibold text-on-surface"
                  htmlFor="refund-manual-reference"
                >
                  Mã tham chiếu giao dịch hoàn tiền
                </label>
                <input
                  id="refund-manual-reference"
                  className="w-full rounded-xl border border-outline-variant bg-surface p-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  placeholder="Ví dụ: FT260727123456"
                  value={approveModal.manualReference}
                  onChange={(event) =>
                    setApproveModal((current) => ({
                      ...current,
                      manualReference: event.target.value,
                    }))
                  }
                />
                <p className="mt-2 text-xs leading-5 text-on-surface-variant">
                  Chỉ nhập sau khi tiền đã được chuyển thực tế về tài khoản khách. Mã này được lưu trong sổ đối soát và nhật ký kiểm toán.
                </p>
              </>
            )}

            <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-on-surface-variant">Đơn hàng</span>
                <span className="text-sm font-bold text-primary">
                  {formatBookingReference(selected.booking?.id)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-on-surface-variant">Khách hàng</span>
                <span className="text-sm font-semibold text-on-surface">
                  {selected.booking?.user?.fullName || selected.booking?.fullName || 'Chưa cập nhật'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-on-surface-variant">Phương thức hoàn</span>
                <span className="text-sm font-semibold text-on-surface">
                  {(selected.booking?.payments || []).some(
                    (p) => p.status === 'SUCCESS' && /vnpay/i.test(p.paymentGateway),
                  )
                    ? 'Tự động qua VNPay'
                    : 'Hoàn thủ công (ngoài cổng)'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-outline-variant pt-3">
                <span className="text-sm font-bold text-on-surface">Số tiền hoàn</span>
                <span className="text-lg font-bold text-primary">
                  {formatMoney(selected.amount)}
                </span>
              </div>
            </div>

            <label
              className="mb-2 mt-4 block text-sm font-semibold text-on-surface"
              htmlFor="refund-approve-notes"
            >
              Ghi chú xử lý (không bắt buộc)
            </label>
            <textarea
              id="refund-approve-notes"
              className="min-h-20 w-full resize-y rounded-xl border border-outline-variant bg-surface p-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              placeholder="Ghi chú nội bộ về quyết định duyệt..."
              value={approveModal.notes}
              onChange={(event) =>
                setApproveModal((current) => ({ ...current, notes: event.target.value }))
              }
            />

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-lg border border-outline-variant bg-white px-4 py-2 text-sm font-semibold text-on-surface"
                onClick={() => setApproveModal({ open: false, notes: '', manualReference: '' })}
                disabled={isProcessing}
              >
                Hủy
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-lg border-0 bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleApprove()}
                disabled={
                  isProcessing
                  || (
                    selected.processingEligibility?.requiresManualReference
                    && !/^[A-Za-z0-9][A-Za-z0-9._/-]{5,99}$/.test(
                      approveModal.manualReference.trim(),
                    )
                  )
                }
              >
                <span className="material-symbols-outlined text-[18px]">check_circle</span>
                {isProcessing ? 'Đang hoàn tiền...' : 'Xác nhận hoàn tiền'}
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isProcessing) {
              setRejectModal({ open: false, notes: '' })
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-refund-title"
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 id="reject-refund-title" className="text-xl font-semibold text-on-surface">
                  Từ chối hoàn tiền
                </h3>
                <p className="mt-1 text-sm text-on-surface-variant">
                  Lý do này sẽ được gửi đến khách hàng qua email.
                </p>
              </div>
              <button
                type="button"
                className="rounded-full border-0 bg-transparent p-1 hover:bg-surface-container-high"
                onClick={() => setRejectModal({ open: false, notes: '' })}
                disabled={isProcessing}
                aria-label="Đóng"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <label
              className="mb-2 block text-sm font-semibold text-on-surface"
              htmlFor="refund-rejection-notes"
            >
              Lý do từ chối <span className="text-error">*</span>
            </label>
            <textarea
              id="refund-rejection-notes"
              className="min-h-32 w-full resize-y rounded-xl border border-outline-variant bg-surface p-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              placeholder="Nhập lý do cụ thể để thông báo cho khách hàng..."
              value={rejectModal.notes}
              onChange={(event) =>
                setRejectModal((current) => ({ ...current, notes: event.target.value }))
              }
              autoFocus
            />

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                className="rounded-lg border border-outline-variant bg-white px-4 py-2 text-sm font-semibold text-on-surface"
                onClick={() => setRejectModal({ open: false, notes: '' })}
                disabled={isProcessing}
              >
                Hủy
              </button>
              <button
                type="button"
                className="rounded-lg border-0 bg-error px-4 py-2 text-sm font-semibold text-on-error disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleReject()}
                disabled={isProcessing}
              >
                {isProcessing ? 'Đang xử lý...' : 'Xác nhận từ chối'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
