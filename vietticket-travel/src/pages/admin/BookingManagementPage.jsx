import { useCallback, useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import { apiRequest } from '../../services/api.js'
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
  const [bookings, setBookings] = useState([])
  const [stats, setStats] = useState({ countsByStatus: {}, refundRequired: 0, grossRevenue: 0 })
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 })
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [onlyRefundRequired, setOnlyRefundRequired] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

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
      const query = new URLSearchParams()
      query.set('page', String(page))
      query.set('limit', String(PAGE_SIZE))
      if (statusFilter) query.set('status', statusFilter)
      if (onlyRefundRequired) query.set('refundRequired', 'true')
      if (search) query.set('search', search)

      const response = await apiRequest(`/admin/bookings?${query.toString()}`)
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
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-5 py-14 text-center text-on-surface-variant">
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
    </AdminLayout>
  )
}
