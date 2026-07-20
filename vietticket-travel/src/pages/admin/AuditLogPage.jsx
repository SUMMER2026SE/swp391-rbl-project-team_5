import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import { getAuditLogs } from '../../services/adminApi.js'

const ENTITY_TYPES = [
  '',
  'USER',
  'PARTNER',
  'ATTRACTION',
  'BOOKING',
  'REFUND_REQUEST',
  'TICKET',
  'SUPPORT_TICKET',
  'REVIEW',
  'CATEGORY',
  'VOUCHER',
  'SETTLEMENT',
]

const ENTITY_TYPE_LABELS = {
  USER: 'Tài khoản',
  PARTNER: 'Đối tác',
  PARTNERPROFILE: 'Hồ sơ đối tác',
  ATTRACTION: 'Điểm tham quan',
  BOOKING: 'Đơn đặt vé',
  REFUND_REQUEST: 'Yêu cầu hoàn tiền',
  REFUNDREQUEST: 'Yêu cầu hoàn tiền',
  TICKET: 'Vé điện tử',
  SUPPORT_TICKET: 'Yêu cầu hỗ trợ',
  SUPPORTTICKET: 'Yêu cầu hỗ trợ',
  REVIEW: 'Đánh giá',
  CATEGORY: 'Danh mục',
  VOUCHER: 'Voucher',
  SETTLEMENT: 'Phiên đối soát',
}

const ACTION_LABELS = {
  PARTNER_KYC_APPROVED: 'Phê duyệt hồ sơ KYC',
  PARTNER_KYC_REJECTED: 'Từ chối hồ sơ KYC',
  ATTRACTION_PUBLISHED: 'Mở bán điểm tham quan',
  ATTRACTION_APPROVED: 'Phê duyệt điểm tham quan',
  ATTRACTION_REJECTED: 'Từ chối điểm tham quan',
  TICKET_CHECKED_IN: 'Check-in vé',
  REFUND_REQUEST_APPROVED: 'Phê duyệt hoàn tiền',
  REFUND_REQUEST_REJECTED: 'Từ chối hoàn tiền',
  SUPPORT_TICKET_RESOLVED: 'Hoàn tất yêu cầu hỗ trợ',
  SUPPORT_TICKET_CLAIMED: 'Tiếp nhận yêu cầu hỗ trợ',
  PARTNER_SETTLEMENT_APPROVED: 'Phê duyệt đối soát',
  PARTNER_SETTLEMENT_PAID: 'Xác nhận đã chi trả',
  REVIEW_HIDDEN: 'Ẩn đánh giá vi phạm',
  ATTRACTION_SUSPENDED: 'Đình chỉ điểm tham quan',
  ATTRACTION_RESTORED: 'Khôi phục điểm tham quan',
  TICKET_REISSUED: 'Cấp lại vé điện tử',
  PARTNER_STAFF_LOCKED: 'Khóa tài khoản nhân viên đối tác',
  PARTNER_STAFF_UNLOCKED: 'Mở khóa tài khoản nhân viên đối tác',
  PARTNER_STAFF_ASSIGNMENTS_REPLACED: 'Cập nhật phân công nhân viên',
  USER_ACCOUNT_LOCKED: 'Khóa tài khoản',
  USER_ACCOUNT_UNLOCKED: 'Mở khóa tài khoản',
}

function entityTypeLabel(value) {
  const key = String(value || '').toUpperCase()
  return ENTITY_TYPE_LABELS[key]
    || ENTITY_TYPE_LABELS[key.replace(/[^A-Z0-9]/g, '')]
    || 'Đối tượng nghiệp vụ'
}

function entityReference(type, value) {
  const id = String(value || '').trim()
  if (!id) return '—'
  const prefixes = { BOOKING: 'VT', TICKET: 'VE', REFUND_REQUEST: 'RF', SUPPORT_TICKET: 'HT', SETTLEMENT: 'ĐS' }
  const key = String(type || '').replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()
  const publicNumericSuffix = id.match(/(\d{12})$/)?.[1]
  let hash = 14695981039346656037n
  for (const character of id) {
    hash ^= BigInt(character.codePointAt(0))
    hash = BigInt.asUintN(64, hash * 1099511628211n)
  }
  const opaqueSuffix = hash.toString(36).toUpperCase().padStart(10, '0').slice(-10)
  return `${prefixes[key] || 'HS'}-${publicNumericSuffix || opaqueSuffix}`
}

const METADATA_LABELS = {
  amount: 'Số tiền',
  businessName: 'Tên doanh nghiệp',
  checkedInCount: 'Số vé đã check-in',
  previousHiddenStatus: 'Trạng thái ẩn trước đó',
  previousOperationalStatus: 'Trạng thái vận hành trước đó',
  previousPublicationStatus: 'Trạng thái mở bán trước đó',
  previousReason: 'Lý do trước đó',
  previousReviewStatus: 'Trạng thái duyệt trước đó',
  previousStatus: 'Trạng thái trước đó',
  reason: 'Lý do',
  rejectionReason: 'Lý do từ chối',
  resolutionNote: 'Kết luận xử lý',
  revision: 'Phiên bản hồ sơ',
  soVeDaCheckIn: 'Số vé đã check-in',
  staffNotes: 'Ghi chú xử lý',
  status: 'Trạng thái mới',
  ticketCount: 'Số vé',
  trangThaiPhatHanh: 'Trạng thái phát hành',
}

const METADATA_VALUE_LABELS = {
  ACTIVE: 'Đang hoạt động',
  APPROVED: 'Đã phê duyệt',
  DRAFT: 'Bản nháp',
  PAID: 'Đã chi trả',
  PAUSED: 'Tạm dừng bán',
  PENDING: 'Chờ xử lý',
  REJECTED: 'Đã từ chối',
  SUSPENDED: 'Đã đình chỉ',
}

function auditMetadataItems(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return []
  return Object.entries(metadata)
    .filter(([key, value]) => METADATA_LABELS[key] && value !== null && typeof value !== 'object')
    .map(([key, value]) => ({
      key,
      label: METADATA_LABELS[key],
      value: typeof value === 'boolean'
        ? (value ? 'Có' : 'Không')
        : key === 'amount'
          ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(Number(value || 0))
          : (METADATA_VALUE_LABELS[String(value)] || String(value)),
    }))
}

function AuditMetadata({ metadata }) {
  const items = auditMetadataItems(metadata)
  if (items.length === 0) return '—'
  return (
    <details>
      <summary className="cursor-pointer font-semibold text-primary">Xem chi tiết</summary>
      <dl className="mt-2 grid max-w-md gap-2 text-xs">
        {items.map((item) => (
          <div key={item.key}>
            <dt className="font-semibold text-on-surface-variant">{item.label}</dt>
            <dd className="whitespace-pre-wrap text-on-surface">{item.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

const formatDateTime = (value) => new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'Asia/Ho_Chi_Minh',
}).format(new Date(value))

export default function AuditLogPage() {
  const [logs, setLogs] = useState([])
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [entityType, setEntityType] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({
    page: 1,
    total: 0,
    totalPages: 1,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getAuditLogs({ search, entityType, page, limit: 25 })
      .then((response) => {
        if (!active) return
        setLogs(response.data || [])
        setPagination(response.pagination || { page: 1, total: 0, totalPages: 1 })
      })
      .catch((error) => {
        if (!active) return
        setLogs([])
        toast.error(error.message || 'Không thể tải nhật ký kiểm toán.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [entityType, page, search])

  return (
    <AdminLayout searchPlaceholder="Tìm nhật ký hệ thống...">
      <div className="admin-page-header">
        <div>
          <h2>Nhật ký kiểm toán</h2>
          <p>Theo dõi ai đã thực hiện thao tác nhạy cảm, trên đối tượng nào và vào thời điểm nào.</p>
        </div>
      </div>

      <section className="financial-section">
        <div className="financial-section-header financial-section-header--transactions">
          <h3>{pagination.total.toLocaleString('vi-VN')} sự kiện</h3>
          <form
            className="financial-search"
            onSubmit={(event) => {
              event.preventDefault()
              const nextSearch = searchDraft.trim()
              if (nextSearch === search && page === 1) return
              setLoading(true)
              setPage(1)
              setSearch(nextSearch)
            }}
          >
            <input
              aria-label="Tìm nhật ký"
              placeholder="Hành động, mã đối tượng, nhân viên..."
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
            <button className="financial-icon-button" type="submit" aria-label="Tìm kiếm">
              <span className="material-symbols-outlined">search</span>
            </button>
          </form>
        </div>
        <div className="financial-filters">
          <label>
            <span>Loại đối tượng</span>
            <select
              value={entityType}
              onChange={(event) => {
                setLoading(true)
                setEntityType(event.target.value)
                setPage(1)
              }}
            >
              {ENTITY_TYPES.map((item) => (
                <option key={item || 'ALL'} value={item}>
                  {item ? (ENTITY_TYPE_LABELS[item] || item) : 'Tất cả'}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table admin-user-table financial-table">
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Người thực hiện</th>
                <th>Hành động</th>
                <th>Đối tượng</th>
                <th>IP</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" className="financial-empty-cell">Đang tải nhật ký...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan="6" className="financial-empty-cell">Không có sự kiện phù hợp.</td></tr>
              ) : logs.map((log) => (
                <tr key={log.id}>
                  <td className="admin-date-cell">{formatDateTime(log.createdAt)}</td>
                  <td>
                    <div className="financial-primary-text">{log.actor?.fullName || 'Hệ thống'}</div>
                    <div className="financial-secondary-text">{log.actor?.email || 'Tác vụ tự động'}</div>
                  </td>
                  <td><span className="financial-status financial-status--processing">{ACTION_LABELS[log.action] || 'Cập nhật nghiệp vụ'}</span></td>
                  <td>
                    <div className="financial-primary-text">{entityTypeLabel(log.entityType)}</div>
                    <div className="financial-reference">{entityReference(log.entityType, log.entityId)}</div>
                  </td>
                  <td className="financial-reference">{log.ipAddress || '—'}</td>
                  <td>
                    <AuditMetadata metadata={log.metadata} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pagination.totalPages > 1 && (
          <div className="admin-pagination">
            <p>Trang {pagination.page} / {pagination.totalPages}</p>
            <div className="admin-pagination__controls">
              <button
                className="admin-pagination-button"
                type="button"
                disabled={page <= 1}
                onClick={() => {
                  setLoading(true)
                  setPage((current) => Math.max(1, current - 1))
                }}
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button
                className="admin-pagination-button"
                type="button"
                disabled={page >= pagination.totalPages}
                onClick={() => {
                  setLoading(true)
                  setPage((current) => Math.min(pagination.totalPages, current + 1))
                }}
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          </div>
        )}
      </section>
    </AdminLayout>
  )
}
