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
                  {item || 'Tất cả'}
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
                  <td><span className="financial-status financial-status--processing">{log.action}</span></td>
                  <td>
                    <div className="financial-primary-text">{log.entityType}</div>
                    <div className="financial-reference">{log.entityId || '—'}</div>
                  </td>
                  <td className="financial-reference">{log.ipAddress || '—'}</td>
                  <td>
                    {log.metadata ? (
                      <details>
                        <summary className="cursor-pointer font-semibold text-primary">Xem dữ liệu</summary>
                        <pre className="mt-2 max-w-md overflow-auto whitespace-pre-wrap text-xs">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      </details>
                    ) : '—'}
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
