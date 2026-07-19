import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import { getAdminBookings } from '../../services/adminApi.js'
import { getBookingStatusMeta } from '../../utils/bookingStatus.js'

// Trang quản lý Booking & Payment toàn sàn cho Admin:
// - Thẻ thống kê theo trạng thái + doanh thu gộp + số đơn cần hoàn tiền.
// - Bảng có lọc trạng thái, lọc "cần hoàn tiền", tìm kiếm, phân trang.
// - Hiển thị cổng thanh toán + trạng thái payment để đối soát.

const PAGE_SIZE = 10

const STATUS_FILTERS = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'PENDING_PAYMENT', label: 'Chờ thanh toán' },
  { value: 'PENDING_PARTNER', label: 'Chờ đối tác duyệt' },
  { value: 'CONFIRMED', label: 'Đã xác nhận' },
  { value: 'COMPLETED', label: 'Đã hoàn thành' },
  { value: 'CANCELLED', label: 'Đã hủy' },
  { value: 'REFUND_REQUESTED', label: 'Chờ hoàn tiền' },
  { value: 'REFUNDED', label: 'Đã hoàn tiền' },
]

const PAYMENT_STATUS_LABELS = {
  SUCCESS: { label: 'Đã thu', className: 'text-primary' },
  PENDING: { label: 'Chưa thu', className: 'text-on-surface-variant' },
  FAILED: { label: 'Thất bại', className: 'text-error' },
}

function formatVND(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value)
}

function formatDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function StatCard({ icon, iconClass, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
        <span className="material-symbols-outlined text-[22px]">{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-on-surface-variant">{label}</p>
        <p className="truncate text-base font-bold text-on-surface">{value}</p>
      </div>
    </div>
  )
}

export default function BookingManagementPage() {
  const navigate = useNavigate()
  const [bookings, setBookings] = useState([])
  const [stats, setStats] = useState({ countsByStatus: {}, refundRequired: 0, grossRevenue: 0 })
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 })
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [onlyRefundRequired, setOnlyRefundRequired] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedBooking, setSelectedBooking] = useState(null)

  useEffect(() => {
    document.title = 'Quản lý Đặt vé & Thanh toán | VietTicket Admin'
  }, [])

  // Debounce ô tìm kiếm
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const fetchBookings = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await getAdminBookings({
        page,
        limit: PAGE_SIZE,
        status: statusFilter,
        refundRequired: onlyRefundRequired,
        search,
      })
      setBookings(response.data || [])
      setStats(response.stats || { countsByStatus: {}, refundRequired: 0, grossRevenue: 0 })
      setPagination(response.pagination || { total: 0, totalPages: 1 })
    } catch (error) {
      toast.error(error.message || 'Không tải được danh sách đặt vé.')
      setBookings([])
    } finally {
      setIsLoading(false)
    }
  }, [page, statusFilter, onlyRefundRequired, search])

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchBookings(), 0)
    return () => window.clearTimeout(timer)
  }, [fetchBookings])

  const counts = stats.countsByStatus || {}
  const totalAll = Object.values(counts).reduce((sum, n) => sum + n, 0)

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm đặt vé...">
      <div className="p-4 sm:p-8">
        <div className="mb-6">
          <h2 className="mb-1 text-3xl font-semibold text-on-surface">
            Quản lý Đặt vé & Thanh toán
          </h2>
          <p className="text-sm text-on-surface-variant">
            Theo dõi toàn bộ đơn đặt vé, trạng thái thanh toán và các đơn cần hoàn tiền trên toàn hệ thống.
          </p>
        </div>

        {/* Thẻ thống kê */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon="receipt_long"
            iconClass="bg-primary-fixed-dim/20 text-primary"
            label="Tổng đơn đặt vé"
            value={totalAll}
          />
          <StatCard
            icon="payments"
            iconClass="bg-primary-fixed-dim/20 text-primary"
            label="Doanh thu gộp (đơn đã xác nhận)"
            value={formatVND(stats.grossRevenue)}
          />
          <StatCard
            icon="pending_actions"
            iconClass="bg-secondary-fixed/30 text-secondary"
            label="Chờ đối tác duyệt"
            value={counts.PENDING_PARTNER || 0}
          />
          <StatCard
            icon="currency_exchange"
            iconClass="bg-error-container/40 text-error"
            label="Đơn cần hoàn tiền"
            value={stats.refundRequired}
          />
        </div>

        {/* Bộ lọc */}
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4 shadow-sm lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">
              search
            </span>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              type="search"
              placeholder="Tìm theo mã đơn, khách hàng, email, địa điểm…"
              className="w-full rounded-full border border-outline-variant bg-surface py-2.5 pl-10 pr-4 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            className="rounded-lg border border-outline-variant bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-on-surface">
            <input
              type="checkbox"
              checked={onlyRefundRequired}
              onChange={(e) => {
                setOnlyRefundRequired(e.target.checked)
                setPage(1)
              }}
              className="h-4 w-4 accent-[var(--md-sys-color-primary,#00474d)]"
            />
            Chỉ đơn cần hoàn tiền
          </label>
        </div>

        {/* Bảng */}
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <span className="material-symbols-outlined animate-spin text-[40px] text-primary">
              progress_activity
            </span>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-outline-variant bg-surface-container-low text-left text-xs font-semibold text-on-surface-variant">
                      <th className="px-5 py-3">Mã đơn</th>
                      <th className="px-5 py-3">Khách hàng</th>
                      <th className="px-5 py-3">Địa điểm / Đối tác</th>
                      <th className="px-5 py-3">Ngày tham quan</th>
                      <th className="px-5 py-3">Số tiền</th>
                      <th className="px-5 py-3">Thanh toán</th>
                      <th className="px-5 py-3">Trạng thái</th>
                      <th className="px-5 py-3 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-5 py-14 text-center text-on-surface-variant">
                          Không tìm thấy đơn đặt vé nào.
                        </td>
                      </tr>
                    ) : (
                      bookings.map((b) => {
                        const statusMeta = getBookingStatusMeta(b.status)
                        const payment = PAYMENT_STATUS_LABELS[b.paymentStatus] || {
                          label: '—',
                          className: 'text-on-surface-variant',
                        }
                        return (
                          <tr key={b.id} className="border-b border-outline-variant/40 hover:bg-surface">
                            <td className="px-5 py-3.5 font-mono text-xs font-semibold text-primary">
                              {b.id.slice(0, 8).toUpperCase()}
                            </td>
                            <td className="px-5 py-3.5">
                              <p className="font-medium text-on-surface">{b.customer}</p>
                              <p className="text-xs text-on-surface-variant">{b.email}</p>
                            </td>
                            <td className="px-5 py-3.5">
                              <p className="text-on-surface">{b.attraction}</p>
                              <p className="text-xs text-on-surface-variant">
                                {b.partner || '—'} · {b.ticketName} × {b.quantity}
                              </p>
                            </td>
                            <td className="px-5 py-3.5 whitespace-nowrap text-on-surface-variant">
                              <p>{b.visitDate}</p>
                              <p className="text-xs">{b.timeSlot || 'Cả ngày'}</p>
                            </td>
                            <td className="px-5 py-3.5 whitespace-nowrap font-semibold text-on-surface">
                              {formatVND(b.totalAmount)}
                            </td>
                            <td className="px-5 py-3.5 whitespace-nowrap">
                              <p className={`font-semibold ${payment.className}`}>{payment.label}</p>
                              <p className="text-xs text-on-surface-variant">{b.paymentGateway || '—'}</p>
                            </td>
                            <td className="px-5 py-3.5">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusMeta.className}`}>
                                {statusMeta.label}
                              </span>
                              {b.refundRequired && (
                                <p className="mt-1 text-[11px] font-bold text-error">Cần hoàn tiền</p>
                              )}
                            </td>
                            <td className="px-5 py-3.5 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => setSelectedBooking(b)}
                                className="rounded-lg border border-outline-variant bg-transparent px-3 py-1.5 text-xs font-semibold text-on-surface hover:bg-surface-container-low"
                              >
                                Chi tiết
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Phân trang */}
            {pagination.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-on-surface-variant">
                  Trang {page}/{pagination.totalPages} · {pagination.total} đơn
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="rounded-lg border border-outline-variant px-3 py-1.5 text-sm text-on-surface hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ← Trước
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                    disabled={page >= pagination.totalPages}
                    className="rounded-lg border border-outline-variant px-3 py-1.5 text-sm text-on-surface hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Sau →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {selectedBooking && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => setSelectedBooking(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              width: '100%',
              maxWidth: 680,
              padding: 32,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
              maxHeight: '90vh',
              overflowY: 'auto',
              color: '#3f484a',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, borderBottom: '1px solid #e1e3e4', paddingBottom: 16 }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--adm-primary-dark)', letterSpacing: '0.05em' }}>MÃ ĐƠN HÀNG: {selectedBooking.id.toUpperCase()}</span>
                <h3 style={{ fontSize: 20, fontWeight: 700, color: '#1a1c1e', margin: '4px 0 0' }}>
                  Chi tiết hóa đơn &amp; Vé đặt
                </h3>
              </div>
              <button
                onClick={() => setSelectedBooking(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#6f797a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Refund Required Alert Banner */}
            {selectedBooking.refundRequired && (
              <div style={{ background: 'rgba(186,26,26,0.1)', border: '1px solid rgba(186,26,26,0.2)', padding: '14px 20px', borderRadius: 12, marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="material-symbols-outlined" style={{ color: 'var(--adm-error)', fontVariationSettings: "'FILL' 1" }}>warning</span>
                  <div>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: 'var(--adm-error)' }}>Yêu cầu hoàn tiền chưa xử lý</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(186,26,26,0.8)' }}>Đơn này đã hủy hoặc gặp sự cố và cần được xử lý hoàn tiền.</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedBooking(null);
                    navigate(`/staff/refunds?search=${selectedBooking.id}`);
                  }}
                  style={{
                    background: 'var(--adm-error)',
                    color: '#fff',
                    border: 'none',
                    padding: '8px 14px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'opacity 150ms',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
                  onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
                >
                  Xử lý hoàn tiền
                </button>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
              {/* Khách hàng */}
              <div style={{ gridColumn: 'span 2' }}>
                <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: '#6f797a', margin: '0 0 12px', letterSpacing: '0.05em' }}>
                  Thông tin khách hàng
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, background: '#f5f7f8', padding: 16, borderRadius: 12 }}>
                  <div>
                    <p style={{ fontSize: 11, color: '#6f797a', margin: '0 0 2px' }}>Họ và tên</p>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: '#1a1c1e' }}>{selectedBooking.customer}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 11, color: '#6f797a', margin: '0 0 2px' }}>Số điện thoại</p>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: '#1a1c1e' }}>{selectedBooking.phone || '—'}</p>
                  </div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <p style={{ fontSize: 11, color: '#6f797a', margin: '0 0 2px' }}>Email liên hệ</p>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: '#1a1c1e' }}>{selectedBooking.email}</p>
                  </div>
                  {selectedBooking.note && (
                    <div style={{ gridColumn: 'span 2', borderTop: '1px solid #e1e3e4', paddingTop: 8, marginTop: 4 }}>
                      <p style={{ fontSize: 11, color: '#6f797a', margin: '0 0 2px' }}>Ghi chú của khách</p>
                      <p style={{ fontSize: 13, margin: 0, fontStyle: 'italic', color: '#3f484a' }}>&ldquo;{selectedBooking.note}&rdquo;</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Vé đặt chi tiết */}
              <div style={{ gridColumn: 'span 2', marginTop: 8 }}>
                <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: '#6f797a', margin: '0 0 12px', letterSpacing: '0.05em' }}>
                  Thông tin vé &amp; Địa điểm
                </h4>
                <div style={{ background: '#f5f7f8', padding: 16, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <p style={{ fontSize: 11, color: '#6f797a', margin: '0 0 2px' }}>Tên địa điểm du lịch</p>
                    <p style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--adm-primary-dark)' }}>{selectedBooking.attraction}</p>
                    {selectedBooking.partner && (
                      <p style={{ fontSize: 11, color: '#6f797a', margin: '2px 0 0' }}>Đối tác quản lý: {selectedBooking.partner}</p>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, borderTop: '1px solid #e1e3e4', paddingTop: 12 }}>
                    <div>
                      <p style={{ fontSize: 11, color: '#6f797a', margin: '0 0 2px' }}>Gói vé &amp; Loại vé</p>
                      <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: '#1a1c1e' }}>
                        {selectedBooking.ticketName} <span style={{ fontSize: 11, color: '#6f797a', fontWeight: 500 }}>({selectedBooking.snapshotTicketType})</span>
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: 11, color: '#6f797a', margin: '0 0 2px' }}>Số lượng</p>
                      <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: '#1a1c1e' }}>{selectedBooking.quantity} vé</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 11, color: '#6f797a', margin: '0 0 2px' }}>Ngày tham quan</p>
                      <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: '#1a1c1e' }}>{selectedBooking.visitDate}</p>
                    </div>
                    <div>
                      <p style={{ fontSize: 11, color: '#6f797a', margin: '0 0 2px' }}>Khung giờ</p>
                      <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: '#1a1c1e' }}>{selectedBooking.timeSlot || 'Cả ngày'}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Chi tiết tài chính */}
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: '#6f797a', margin: '0 0 12px', letterSpacing: '0.05em' }}>
                  Chi tiết thanh toán
                </h4>
                <div style={{ background: '#f5f7f8', padding: 16, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: '#6f797a' }}>Giá gốc ({selectedBooking.quantity}x)</span>
                    <span style={{ fontWeight: 500, color: '#1a1c1e' }}>{formatVND(selectedBooking.subtotalAmount || selectedBooking.totalAmount)}</span>
                  </div>
                  {selectedBooking.discountAmount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: '#6f797a' }}>Giảm giá (Voucher)</span>
                      <span style={{ fontWeight: 600, color: 'var(--adm-error)' }}>-{formatVND(selectedBooking.discountAmount)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderTop: '1px solid #e1e3e4', paddingTop: 8, marginTop: 4 }}>
                    <span style={{ fontWeight: 700, color: '#1a1c1e' }}>Tổng tiền thu</span>
                    <span style={{ fontWeight: 700, color: 'var(--adm-primary-dark)' }}>{formatVND(selectedBooking.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {/* Cổng thanh toán & Trạng thái */}
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: '#6f797a', margin: '0 0 12px', letterSpacing: '0.05em' }}>
                  Trạng thái thanh toán
                </h4>
                <div style={{ background: '#f5f7f8', padding: 16, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: '#6f797a' }}>Cổng giao dịch</span>
                    <span style={{ fontWeight: 600, color: '#1a1c1e' }}>{selectedBooking.paymentGateway || 'Chưa thực hiện'}</span>
                  </div>
                  {selectedBooking.transactionId && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: '#6f797a' }}>Mã giao dịch</span>
                      <span style={{ fontWeight: 600, color: '#1a1c1e', fontFamily: 'monospace', fontSize: 11 }}>{selectedBooking.transactionId}</span>
                    </div>
                  )}
                  {selectedBooking.paidAt && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: '#6f797a' }}>Thời gian</span>
                      <span style={{ fontWeight: 500, color: '#1a1c1e' }}>{formatDateTime(selectedBooking.paidAt)}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: '#6f797a' }}>Trạng thái</span>
                    <span style={{ fontWeight: 700, color: selectedBooking.paymentStatus === 'SUCCESS' ? '#10b981' : 'var(--adm-error)' }}>
                      {selectedBooking.paymentStatus === 'SUCCESS' ? 'Đã thanh toán thành công' : selectedBooking.paymentStatus || 'Chưa thanh toán'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Danh sách phiên vé & trạng thái check-in. Không hiển thị QR credential. */}
              <div style={{ gridColumn: 'span 2', marginTop: 8 }}>
                <h4 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: '#6f797a', margin: '0 0 12px', letterSpacing: '0.05em' }}>
                  Danh sách phiên vé &amp; Kiểm vé
                </h4>
                <div style={{ overflowX: 'auto', border: '1px solid #e1e3e4', borderRadius: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f5f7f8', borderBottom: '1px solid #e1e3e4' }}>
                        <th style={{ padding: '10px 16px', fontWeight: 600, color: '#6f797a' }}>Mã phiên vé</th>
                        <th style={{ padding: '10px 16px', fontWeight: 600, color: '#6f797a' }}>Trạng thái</th>
                        <th style={{ padding: '10px 16px', fontWeight: 600, color: '#6f797a' }}>Thời gian Check-in</th>
                        <th style={{ padding: '10px 16px', fontWeight: 600, color: '#6f797a' }}>Nhân viên duyệt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!selectedBooking.ticketInstances || selectedBooking.ticketInstances.length === 0) ? (
                        <tr>
                          <td colSpan={4} style={{ padding: 16, textAlign: 'center', color: '#6f797a', fontStyle: 'italic' }}>
                            Chưa phát hành mã QR vé cho đơn này (thanh toán chưa thành công).
                          </td>
                        </tr>
                      ) : (
                        selectedBooking.ticketInstances.map((t) => (
                          <tr key={t.id} style={{ borderBottom: '1px solid #e1e3e4' }}>
                            <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: 'var(--adm-primary-dark)' }}>
                              {t.id}
                            </td>
                            <td style={{ padding: '10px 16px' }}>
                              <span style={{
                                padding: '2px 8px',
                                borderRadius: 9999,
                                fontSize: 11,
                                fontWeight: 700,
                                background: t.status === 'USED' ? 'rgba(16,185,129,0.1)' : t.status === 'REFUNDED' ? 'rgba(186,26,26,0.1)' : 'rgba(0,96,104,0.1)',
                                color: t.status === 'USED' ? '#10b981' : t.status === 'REFUNDED' ? 'var(--adm-error)' : 'var(--adm-primary-dark)',
                              }}>
                                {t.status}
                              </span>
                            </td>
                            <td style={{ padding: '10px 16px', color: '#3f484a' }}>
                              {t.checkedInAt ? formatDateTime(t.checkedInAt) : '—'}
                            </td>
                            <td style={{ padding: '10px 16px', color: '#3f484a', fontWeight: 500 }}>
                              {t.checkedInBy?.fullName || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ marginTop: 32, display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #e1e3e4', paddingTop: 16 }}>
              <button
                onClick={() => setSelectedBooking(null)}
                style={{
                  padding: '10px 24px',
                  borderRadius: 8,
                  border: '1px solid #bec8ca',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#3f484a',
                }}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
