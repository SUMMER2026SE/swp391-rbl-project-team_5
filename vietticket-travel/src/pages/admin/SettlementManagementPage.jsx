import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout.jsx'
import {
  createSettlement,
  getPartners,
  getSettlements,
  updateSettlementStatus,
} from '../../services/adminApi.js'

const STATUS_LABELS = {
  DRAFT: 'Nháp',
  APPROVED: 'Đã duyệt',
  PAID: 'Đã chuyển khoản',
  CANCELLED: 'Đã hủy',
}

const FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'DRAFT', label: 'Nháp' },
  { value: 'APPROVED', label: 'Chờ chuyển khoản' },
  { value: 'PAID', label: 'Đã chuyển khoản' },
  { value: 'CANCELLED', label: 'Đã hủy' },
]

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
}).format(Number(value || 0))

const formatDate = (value) => value
  ? new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC' }).format(new Date(value))
  : '—'

function defaultPeriod() {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  return {
    partnerId: '',
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  }
}

export default function SettlementManagementPage() {
  const [settlements, setSettlements] = useState([])
  const [partners, setPartners] = useState([])
  const [stats, setStats] = useState({})
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [refreshIndex, setRefreshIndex] = useState(0)
  const [showCreate, setShowCreate] = useState(false)
  const [createDraft, setCreateDraft] = useState(defaultPeriod)
  const [submitting, setSubmitting] = useState(false)
  const [action, setAction] = useState(null)
  const [actionValue, setActionValue] = useState('')

  useEffect(() => {
    let active = true
    getSettlements({ status, page, limit: 20 })
      .then((response) => {
        if (!active) return
        setSettlements(response.data || [])
        setStats(response.stats || {})
        setPagination(response.pagination || { page: 1, total: 0, totalPages: 1 })
      })
      .catch((error) => {
        if (!active) return
        setSettlements([])
        toast.error(error.message || 'Không thể tải danh sách đối soát.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [page, refreshIndex, status])

  useEffect(() => {
    let active = true
    getPartners({ status: 'APPROVED', page: 1, limit: 100 })
      .then((response) => {
        if (active) setPartners(response.data || [])
      })
      .catch(() => {
        if (active) setPartners([])
      })
    return () => {
      active = false
    }
  }, [])

  const cards = useMemo(() => [
    { label: 'Bản nháp', value: stats.DRAFT?.count || 0, amount: stats.DRAFT?.payableAmount || 0 },
    { label: 'Chờ chuyển khoản', value: stats.APPROVED?.count || 0, amount: stats.APPROVED?.payableAmount || 0 },
    { label: 'Đã chuyển khoản', value: stats.PAID?.count || 0, amount: stats.PAID?.payableAmount || 0 },
    { label: 'Đã hủy', value: stats.CANCELLED?.count || 0, amount: stats.CANCELLED?.payableAmount || 0 },
  ], [stats])

  const reload = () => {
    setLoading(true)
    setRefreshIndex((current) => current + 1)
  }

  async function handleCreate(event) {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    try {
      const response = await createSettlement(createDraft)
      toast.success(response.message)
      setShowCreate(false)
      setCreateDraft(defaultPeriod())
      setPage(1)
      reload()
    } catch (error) {
      toast.error(error.message || 'Không thể lập kỳ đối soát.')
    } finally {
      setSubmitting(false)
    }
  }

  async function approve(settlement) {
    if (!window.confirm(`Duyệt đối soát ${formatCurrency(settlement.payableAmount)} cho ${settlement.partner.businessName}?`)) {
      return
    }
    setSubmitting(true)
    try {
      const response = await updateSettlementStatus(settlement.id, 'APPROVED')
      toast.success(response.message)
      reload()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function submitAction(event) {
    event.preventDefault()
    if (!action || submitting) return
    setSubmitting(true)
    try {
      const response = await updateSettlementStatus(
        action.settlement.id,
        action.type,
        action.type === 'PAID'
          ? { bankReference: actionValue.trim() }
          : { reason: actionValue.trim() },
      )
      toast.success(response.message)
      setAction(null)
      setActionValue('')
      reload()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AdminLayout searchPlaceholder="Tìm đối soát...">
      <div className="admin-page-header">
        <div>
          <h2>Đối soát và chi trả đối tác</h2>
          <p>Chốt doanh thu theo booking đã hoàn tất, duyệt số tiền và lưu tham chiếu chuyển khoản.</p>
        </div>
        <button
          type="button"
          className="admin-modal-button admin-modal-button--primary"
          onClick={() => setShowCreate(true)}
        >
          <span className="material-symbols-outlined">add</span>
          Lập kỳ đối soát
        </button>
      </div>

      <div className="admin-stats-grid financial-stats-grid">
        {cards.map((card) => (
          <article className="admin-stat-card" key={card.label}>
            <p className="admin-stat-card__label">{card.label} ({card.value})</p>
            <p className="admin-stat-card__value financial-stat-value">{formatCurrency(card.amount)}</p>
          </article>
        ))}
      </div>

      <section className="financial-section">
        <div className="financial-section-header">
          <h3>{pagination.total.toLocaleString('vi-VN')} kỳ đối soát</h3>
          <div className="financial-filters">
            <label>
              <span>Trạng thái</span>
              <select
                value={status}
                onChange={(event) => {
                  setLoading(true)
                  setStatus(event.target.value)
                  setPage(1)
                }}
              >
                {FILTERS.map((item) => (
                  <option key={item.value || 'ALL'} value={item.value}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table admin-user-table financial-table">
            <thead>
              <tr>
                <th>Đối tác / Kỳ</th>
                <th>Trạng thái</th>
                <th className="admin-table-cell--right">Booking</th>
                <th className="admin-table-cell--right">Doanh số thuần</th>
                <th className="admin-table-cell--right">Hoa hồng</th>
                <th className="admin-table-cell--right">Phải trả</th>
                <th>Ngân hàng</th>
                <th className="admin-table-cell--right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" className="financial-empty-cell">Đang tải dữ liệu...</td></tr>
              ) : settlements.length === 0 ? (
                <tr><td colSpan="8" className="financial-empty-cell">Chưa có kỳ đối soát phù hợp.</td></tr>
              ) : settlements.map((settlement) => (
                <tr key={settlement.id}>
                  <td>
                    <div className="financial-primary-text">{settlement.partner.businessName}</div>
                    <div className="financial-secondary-text">
                      {formatDate(settlement.periodStart)} – {formatDate(settlement.periodEnd)}
                    </div>
                  </td>
                  <td>
                    <span className={`financial-status financial-status--${settlement.status.toLowerCase()}`}>
                      {STATUS_LABELS[settlement.status]}
                    </span>
                    {settlement.bankReference && (
                      <div className="financial-secondary-text">Mã: {settlement.bankReference}</div>
                    )}
                  </td>
                  <td className="admin-table-cell--right">{settlement.bookingCount}</td>
                  <td className="admin-table-cell--right">{formatCurrency(settlement.netAmount)}</td>
                  <td className="admin-table-cell--right">{formatCurrency(settlement.commissionAmount)}</td>
                  <td className="admin-table-cell--right financial-emphasis">{formatCurrency(settlement.payableAmount)}</td>
                  <td>
                    <div className="financial-primary-text">{settlement.bankNameSnapshot}</div>
                    <div className="financial-secondary-text">
                      {settlement.bankAccountNameSnapshot} · ****{settlement.bankAccountLast4Snapshot}
                    </div>
                  </td>
                  <td className="admin-table-cell--right">
                    <div className="admin-row-actions">
                      {settlement.status === 'DRAFT' && (
                        <button
                          type="button"
                          className="admin-row-action admin-row-action--primary"
                          disabled={submitting}
                          title="Duyệt đối soát"
                          onClick={() => void approve(settlement)}
                        >
                          <span className="material-symbols-outlined">approval</span>
                        </button>
                      )}
                      {settlement.status === 'APPROVED' && (
                        <button
                          type="button"
                          className="admin-row-action admin-row-action--primary"
                          disabled={submitting}
                          title="Ghi nhận chuyển khoản"
                          onClick={() => {
                            setAction({ type: 'PAID', settlement })
                            setActionValue('')
                          }}
                        >
                          <span className="material-symbols-outlined">payments</span>
                        </button>
                      )}
                      {['DRAFT', 'APPROVED'].includes(settlement.status) && (
                        <button
                          type="button"
                          className="admin-row-action admin-row-action--danger"
                          disabled={submitting}
                          title="Hủy kỳ đối soát"
                          onClick={() => {
                            setAction({ type: 'CANCELLED', settlement })
                            setActionValue('')
                          }}
                        >
                          <span className="material-symbols-outlined">cancel</span>
                        </button>
                      )}
                    </div>
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
                type="button"
                className="admin-pagination-button"
                disabled={page <= 1}
                onClick={() => {
                  setLoading(true)
                  setPage((current) => current - 1)
                }}
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button
                type="button"
                className="admin-pagination-button"
                disabled={page >= pagination.totalPages}
                onClick={() => {
                  setLoading(true)
                  setPage((current) => current + 1)
                }}
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {showCreate && (
        <div className="admin-modal-container">
          <button
            type="button"
            className="admin-modal-backdrop"
            disabled={submitting}
            aria-label="Đóng"
            onClick={() => setShowCreate(false)}
          />
          <form className="admin-modal" role="dialog" aria-modal="true" onSubmit={handleCreate}>
            <div className="admin-modal__header">
              <span className="admin-modal__icon admin-modal__icon--primary">
                <span className="material-symbols-outlined">request_quote</span>
              </span>
              <div>
                <h3>Lập kỳ đối soát</h3>
                <p>Chỉ booking đã hoàn tất, đã thu tiền và chưa thuộc kỳ khác được đưa vào.</p>
              </div>
            </div>
            <label className="admin-field">
              <span>Đối tác</span>
              <select
                required
                value={createDraft.partnerId}
                onChange={(event) => setCreateDraft((current) => ({
                  ...current,
                  partnerId: event.target.value,
                }))}
              >
                <option value="">Chọn đối tác đã duyệt</option>
                {partners.map((partner) => (
                  <option key={partner.id} value={partner.id}>{partner.businessName}</option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="admin-field">
                <span>Từ ngày</span>
                <input
                  required
                  type="date"
                  value={createDraft.periodStart}
                  onChange={(event) => setCreateDraft((current) => ({
                    ...current,
                    periodStart: event.target.value,
                  }))}
                />
              </label>
              <label className="admin-field">
                <span>Đến ngày</span>
                <input
                  required
                  type="date"
                  value={createDraft.periodEnd}
                  onChange={(event) => setCreateDraft((current) => ({
                    ...current,
                    periodEnd: event.target.value,
                  }))}
                />
              </label>
            </div>
            <div className="admin-modal__actions">
              <button type="button" className="admin-modal-button admin-modal-button--secondary" onClick={() => setShowCreate(false)}>
                Hủy
              </button>
              <button type="submit" disabled={submitting} className="admin-modal-button admin-modal-button--primary">
                {submitting ? 'Đang lập...' : 'Lập bản nháp'}
              </button>
            </div>
          </form>
        </div>
      )}

      {action && (
        <div className="admin-modal-container">
          <button
            type="button"
            className="admin-modal-backdrop"
            disabled={submitting}
            aria-label="Đóng"
            onClick={() => setAction(null)}
          />
          <form className="admin-modal" role="dialog" aria-modal="true" onSubmit={submitAction}>
            <div className="admin-modal__header">
              <span className={`admin-modal__icon ${action.type === 'PAID' ? 'admin-modal__icon--primary' : 'admin-modal__icon--danger'}`}>
                <span className="material-symbols-outlined">
                  {action.type === 'PAID' ? 'payments' : 'cancel'}
                </span>
              </span>
              <div>
                <h3>{action.type === 'PAID' ? 'Xác nhận đã chuyển khoản' : 'Hủy kỳ đối soát'}</h3>
                <p>{action.settlement.partner.businessName} · {formatCurrency(action.settlement.payableAmount)}</p>
              </div>
            </div>
            <label className="admin-field">
              <span>{action.type === 'PAID' ? 'Mã tham chiếu ngân hàng' : 'Lý do hủy'}</span>
              {action.type === 'PAID' ? (
                <input
                  required
                  minLength="3"
                  maxLength="100"
                  value={actionValue}
                  onChange={(event) => setActionValue(event.target.value)}
                />
              ) : (
                <textarea
                  required
                  minLength="10"
                  maxLength="1000"
                  value={actionValue}
                  onChange={(event) => setActionValue(event.target.value)}
                />
              )}
            </label>
            <div className="admin-modal__actions">
              <button type="button" className="admin-modal-button admin-modal-button--secondary" onClick={() => setAction(null)}>
                Quay lại
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={`admin-modal-button ${action.type === 'PAID' ? 'admin-modal-button--primary' : 'admin-modal-button--danger'}`}
              >
                {submitting ? 'Đang xử lý...' : 'Xác nhận'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AdminLayout>
  )
}
