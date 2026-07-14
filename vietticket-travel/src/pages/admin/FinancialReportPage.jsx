import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout'
import {
  changePartnerCommissionRate,
  getFinancialReport,
  getFinancialTransactions,
} from '../../services/adminApi'
import '../../styles/admin.css'

const PERIODS = [
  { value: 'week', label: 'Tuần' },
  { value: 'month', label: 'Tháng' },
  { value: 'year', label: 'Năm' },
]

const TRANSACTION_TYPES = [
  { value: 'ALL', label: 'Tất cả giao dịch' },
  { value: 'PAYMENT', label: 'Thanh toán' },
  { value: 'REFUND', label: 'Hoàn tiền' },
]

const TRANSACTION_STATUSES = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'PENDING', label: 'Đang chờ' },
  { value: 'PROCESSING', label: 'Đang xử lý' },
  { value: 'SUCCESS', label: 'Thành công' },
  { value: 'FAILED', label: 'Thất bại' },
  { value: 'NEEDS_RECONCILIATION', label: 'Cần đối soát' },
]

const STATUS_LABELS = {
  PENDING: 'Đang chờ',
  PROCESSING: 'Đang xử lý',
  SUCCESS: 'Thành công',
  FAILED: 'Thất bại',
  NEEDS_RECONCILIATION: 'Cần đối soát',
}

const PARTNER_STATUS_LABELS = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Hoạt động',
  REJECTED: 'Từ chối',
  SUSPENDED: 'Tạm khóa',
}

const formatCurrency = (value) => new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
}).format(Number(value || 0))

const formatDateTime = (value) => (
  value
    ? new Intl.DateTimeFormat('vi-VN', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(new Date(value))
    : '—'
)

function LoadingRow({ columns }) {
  return (
    <tr>
      <td className="financial-empty-cell" colSpan={columns}>Đang tải dữ liệu...</td>
    </tr>
  )
}

function EmptyRow({ columns, children }) {
  return (
    <tr>
      <td className="financial-empty-cell" colSpan={columns}>{children}</td>
    </tr>
  )
}

export default function FinancialReportPage() {
  const [period, setPeriod] = useState('month')
  const [report, setReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(true)
  const [rateDrafts, setRateDrafts] = useState({})
  const [savingPartnerId, setSavingPartnerId] = useState('')

  const [transactionType, setTransactionType] = useState('ALL')
  const [transactionStatus, setTransactionStatus] = useState('')
  const [searchDraft, setSearchDraft] = useState('')
  const [search, setSearch] = useState('')
  const [transactions, setTransactions] = useState([])
  const [transactionsLoading, setTransactionsLoading] = useState(true)

  useEffect(() => {
    let active = true
    getFinancialReport(period)
      .then((response) => {
        if (!active) return
        setReport(response.data)
        setRateDrafts(Object.fromEntries(
          (response.data.partners || []).map((partner) => [
            partner.id,
            String(partner.commissionRatePercent),
          ]),
        ))
      })
      .catch((error) => {
        if (!active) return
        setReport(null)
        toast.error(error.message)
      })
      .finally(() => {
        if (active) setReportLoading(false)
      })

    return () => {
      active = false
    }
  }, [period])

  useEffect(() => {
    let active = true
    getFinancialTransactions({
      period,
      type: transactionType,
      status: transactionStatus,
      search,
      limit: 50,
    })
      .then((response) => {
        if (active) setTransactions(response.data.transactions || [])
      })
      .catch((error) => {
        if (!active) return
        setTransactions([])
        toast.error(error.message)
      })
      .finally(() => {
        if (active) setTransactionsLoading(false)
      })

    return () => {
      active = false
    }
  }, [period, search, transactionStatus, transactionType])

  const summary = report?.summary || {}
  const stats = [
    { icon: 'payments', label: 'Tổng tiền cổng đã thu', value: formatCurrency(summary.capturedAmount) },
    { icon: 'currency_exchange', label: 'Tiền hoàn thành công', value: formatCurrency(summary.refundedAmount) },
    { icon: 'account_balance_wallet', label: 'Dòng tiền thuần', value: formatCurrency(summary.netCashAmount) },
    { icon: 'percent', label: 'Hoa hồng đã ghi nhận', value: formatCurrency(summary.commissionRevenueAmount) },
    { icon: 'receipt_long', label: 'Doanh số thuần đã ghi nhận', value: formatCurrency(summary.recognizedNetAmount) },
    { icon: 'account_balance', label: 'Phải trả đối tác', value: formatCurrency(summary.partnerPayableAmount) },
    { icon: 'pending_actions', label: `Khoản hoàn đang mở (${summary.openRefundCount || 0})`, value: formatCurrency(summary.openRefundAmount) },
    { icon: 'sync_problem', label: `Cần đối soát (${summary.needsReconciliationCount || 0})`, value: formatCurrency(summary.needsReconciliationAmount) },
  ]

  const saveCommission = async (partner) => {
    const nextRate = Number(rateDrafts[partner.id])
    if (!Number.isInteger(nextRate) || nextRate < 0 || nextRate > 100) {
      toast.error('Tỷ lệ hoa hồng phải là số nguyên từ 0 đến 100.')
      return
    }
    if (nextRate === partner.commissionRatePercent) return

    setSavingPartnerId(partner.id)
    try {
      const response = await changePartnerCommissionRate(partner.id, nextRate)
      setReport((current) => ({
        ...current,
        partners: current.partners.map((item) => (
          item.id === partner.id
            ? {
                ...item,
                commissionRate: response.data.commissionRate,
                commissionRatePercent: response.data.commissionRatePercent,
              }
            : item
        )),
      }))
      setRateDrafts((current) => ({
        ...current,
        [partner.id]: String(response.data.commissionRatePercent),
      }))
      toast.success(response.message)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSavingPartnerId('')
    }
  }

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm hệ thống...">
      <div className="admin-page-header">
        <div>
          <h2>Báo cáo tài chính</h2>
          <p>Đối soát Payment, Refund và hoa hồng nền tảng.</p>
        </div>
        <div className="admin-chart-period-toggle" aria-label="Kỳ báo cáo">
          {PERIODS.map((item) => (
            <button
              className={period === item.value ? 'active' : ''}
              key={item.value}
              onClick={() => {
                if (item.value === period) return
                setReportLoading(true)
                setTransactionsLoading(true)
                setPeriod(item.value)
              }}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {reportLoading ? (
        <div className="admin-page-section financial-loading">Đang tải báo cáo...</div>
      ) : !report ? (
        <div className="admin-page-section financial-loading">Không thể tải báo cáo tài chính.</div>
      ) : (
        <>
          <div className="admin-stats-grid financial-stats-grid">
            {stats.map((stat) => (
              <div className="admin-stat-card" key={stat.label}>
                <div className="admin-stat-card__top">
                  <div className="admin-stat-card__icon-wrap admin-stat-card__icon-wrap--primary">
                    <span className="material-symbols-outlined">{stat.icon}</span>
                  </div>
                </div>
                <p className="admin-stat-card__label">{stat.label}</p>
                <p className="admin-stat-card__value financial-stat-value">{stat.value}</p>
              </div>
            ))}
          </div>

          <section className="financial-section">
            <div className="financial-section-header">
              <h3>Dòng tiền theo kỳ</h3>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table admin-user-table financial-table">
                <thead>
                  <tr>
                    <th>Mốc</th>
                    <th className="admin-table-cell--right">Tiền thu</th>
                    <th className="admin-table-cell--right">Tiền hoàn</th>
                    <th className="admin-table-cell--right">Dòng tiền thuần</th>
                    <th className="admin-table-cell--right">Số giao dịch</th>
                  </tr>
                </thead>
                <tbody>
                  {report.timeline.map((item) => (
                    <tr key={item.label}>
                      <td>{item.label}</td>
                      <td className="admin-table-cell--right">{formatCurrency(item.capturedAmount)}</td>
                      <td className="admin-table-cell--right financial-negative">{formatCurrency(item.refundedAmount)}</td>
                      <td className="admin-table-cell--right financial-emphasis">{formatCurrency(item.netCashAmount)}</td>
                      <td className="admin-table-cell--right">{item.paymentCount + item.refundCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="financial-section">
            <div className="financial-section-header">
              <h3>Đối tác và hoa hồng</h3>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table admin-user-table financial-table">
                <thead>
                  <tr>
                    <th>Đối tác</th>
                    <th>Trạng thái</th>
                    <th className="admin-table-cell--right">Doanh số thuần ghi nhận</th>
                    <th className="admin-table-cell--right">Hoa hồng kỳ này</th>
                    <th className="admin-table-cell--right">Phải trả đối tác</th>
                    <th className="admin-table-cell--right">Tỷ lệ booking mới</th>
                  </tr>
                </thead>
                <tbody>
                  {report.partners.length === 0 ? (
                    <EmptyRow columns={6}>Chưa có hồ sơ đối tác.</EmptyRow>
                  ) : report.partners.map((partner) => (
                    <tr key={partner.id}>
                      <td className="financial-partner-name">{partner.businessName}</td>
                      <td>
                        <span className={`financial-status financial-status--${partner.status.toLowerCase()}`}>
                          {PARTNER_STATUS_LABELS[partner.status] || partner.status}
                        </span>
                      </td>
                      <td className="admin-table-cell--right">{formatCurrency(partner.recognizedNetAmount)}</td>
                      <td className="admin-table-cell--right">{formatCurrency(partner.commissionRevenueAmount)}</td>
                      <td className="admin-table-cell--right">{formatCurrency(partner.partnerPayableAmount)}</td>
                      <td className="admin-table-cell--right">
                        <div className="financial-rate-control">
                          <input
                            aria-label={`Tỷ lệ hoa hồng ${partner.businessName}`}
                            inputMode="numeric"
                            max="100"
                            min="0"
                            onChange={(event) => setRateDrafts((current) => ({
                              ...current,
                              [partner.id]: event.target.value,
                            }))}
                            step="1"
                            type="number"
                            value={rateDrafts[partner.id] ?? ''}
                          />
                          <span>%</span>
                          <button
                            aria-label={`Lưu tỷ lệ hoa hồng ${partner.businessName}`}
                            className="financial-icon-button"
                            disabled={
                              savingPartnerId === partner.id
                              || Number(rateDrafts[partner.id]) === partner.commissionRatePercent
                            }
                            onClick={() => saveCommission(partner)}
                            title="Lưu tỷ lệ hoa hồng"
                            type="button"
                          >
                            <span className="material-symbols-outlined">
                              {savingPartnerId === partner.id ? 'progress_activity' : 'save'}
                            </span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="financial-section">
        <div className="financial-section-header financial-section-header--transactions">
          <h3>Lịch sử giao dịch</h3>
          <form
            className="financial-search"
            onSubmit={(event) => {
              event.preventDefault()
              const nextSearch = searchDraft.trim()
              if (nextSearch === search) return
              setTransactionsLoading(true)
              setSearch(nextSearch)
            }}
          >
            <input
              aria-label="Tìm giao dịch"
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Mã booking, mã giao dịch, khách hàng..."
              type="search"
              value={searchDraft}
            />
            <button aria-label="Tìm kiếm" className="financial-icon-button" title="Tìm kiếm" type="submit">
              <span className="material-symbols-outlined">search</span>
            </button>
          </form>
        </div>
        <div className="financial-filters">
          <label>
            <span>Loại giao dịch</span>
            <select
              value={transactionType}
              onChange={(event) => {
                setTransactionsLoading(true)
                setTransactionType(event.target.value)
              }}
            >
              {TRANSACTION_TYPES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Trạng thái</span>
            <select
              value={transactionStatus}
              onChange={(event) => {
                setTransactionsLoading(true)
                setTransactionStatus(event.target.value)
              }}
            >
              {TRANSACTION_STATUSES.map((item) => (
                <option key={item.value || 'ALL'} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table admin-user-table financial-table">
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>Loại</th>
                <th>Mã giao dịch</th>
                <th>Booking / Khách hàng</th>
                <th>Đối tác / Địa điểm</th>
                <th>Trạng thái</th>
                <th className="admin-table-cell--right">Số tiền</th>
              </tr>
            </thead>
            <tbody>
              {transactionsLoading ? (
                <LoadingRow columns={7} />
              ) : transactions.length === 0 ? (
                <EmptyRow columns={7}>Không có giao dịch phù hợp.</EmptyRow>
              ) : transactions.map((transaction) => (
                <tr key={`${transaction.type}-${transaction.id}`}>
                  <td className="admin-date-cell">{formatDateTime(transaction.occurredAt)}</td>
                  <td>
                    <span className={`financial-transaction-type financial-transaction-type--${transaction.type.toLowerCase()}`}>
                      {transaction.type === 'PAYMENT' ? 'Thanh toán' : 'Hoàn tiền'}
                    </span>
                    {transaction.isDuplicate && <span className="financial-duplicate">Thanh toán trùng</span>}
                  </td>
                  <td className="financial-reference" title={transaction.reference}>{transaction.reference}</td>
                  <td>
                    <div className="financial-primary-text">{transaction.bookingId}</div>
                    <div className="financial-secondary-text">{transaction.customer} · {transaction.customerEmail}</div>
                  </td>
                  <td>
                    <div className="financial-primary-text">{transaction.partner || '—'}</div>
                    <div className="financial-secondary-text">{transaction.attraction || '—'}</div>
                  </td>
                  <td>
                    <span className={`financial-status financial-status--${transaction.status.toLowerCase()}`}>
                      {STATUS_LABELS[transaction.status] || transaction.status}
                    </span>
                  </td>
                  <td className={`admin-table-cell--right financial-emphasis ${transaction.type === 'REFUND' ? 'financial-negative' : ''}`}>
                    {transaction.type === 'REFUND' ? '−' : '+'}{formatCurrency(transaction.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminLayout>
  )
}
