import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout'
import { getDashboard } from '../../services/adminApi'
import '../../styles/admin.css'

const PERIODS = [
  { value: 'week', label: 'Tuần' },
  { value: 'month', label: 'Tháng' },
  { value: 'year', label: 'Năm' },
]

const formatCurrency = (value) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))

function EmptyState({ children }) {
  return <p className="admin-empty-state">{children}</p>
}

export default function AdminDashboard() {
  const [period, setPeriod] = useState('month')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getDashboard(period)
      .then((response) => {
        if (active) setData(response.data)
      })
      .catch((error) => {
        if (active) {
          setData(null)
          toast.error(error.message)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [period])

  const maxRevenue = useMemo(
    () => Math.max(1, ...(data?.trend || []).map((item) => item.revenue)),
    [data],
  )

  const stats = [
    {
      icon: 'payments',
      label: 'Doanh thu đã thanh toán',
      value: formatCurrency(data?.stats.revenue),
    },
    {
      icon: 'confirmation_number',
      label: 'Đơn trong kỳ',
      value: (data?.stats.bookings || 0).toLocaleString('vi-VN'),
    },
    {
      icon: 'map',
      label: 'Điểm đang hoạt động',
      value: `${data?.stats.activeAttractions || 0}/${data?.stats.totalAttractions || 0}`,
    },
    {
      icon: 'person_add',
      label: 'Đối tác mới trong kỳ',
      value: (data?.stats.newPartners || 0).toLocaleString('vi-VN'),
    },
  ]

  const exportCsv = () => {
    if (!data) return
    const rows = [
      ['Mốc thời gian', 'Doanh thu', 'Số giao dịch'],
      ...data.trend.map((item) => [item.label, item.revenue, item.bookings]),
    ]
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `vietticket-dashboard-${period}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm hệ thống...">
      <div className="admin-page-header">
        <div>
          <h2>Tổng quan hệ thống</h2>
          <p>Dữ liệu doanh thu chỉ ghi nhận giao dịch thành công và đơn hợp lệ.</p>
        </div>
        <button className="admin-export-btn" onClick={exportCsv} disabled={!data}>
          <span className="material-symbols-outlined">download</span>
          Xuất CSV
        </button>
      </div>

      {loading ? (
        <div className="admin-page-section admin-empty-state">Đang tải dữ liệu...</div>
      ) : !data ? (
        <div className="admin-page-section">
          <EmptyState>Không thể tải dashboard. Vui lòng kiểm tra kết nối máy chủ.</EmptyState>
        </div>
      ) : (
        <>
          <div className="admin-stats-grid">
            {stats.map((stat) => (
              <div className="admin-stat-card soft-elevation" key={stat.label}>
                <div className="admin-stat-card__top">
                  <div className="admin-stat-card__icon-wrap admin-stat-card__icon-wrap--primary">
                    <span className="material-symbols-outlined">{stat.icon}</span>
                  </div>
                </div>
                <p className="admin-stat-card__label">{stat.label}</p>
                <p className="admin-stat-card__value">{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="admin-viz-grid">
            <section className="admin-chart-card soft-elevation">
              <div className="admin-chart-card__header">
                <h3 className="admin-chart-card__title">Xu hướng doanh thu</h3>
                <div className="admin-chart-period-toggle">
                  {PERIODS.map((item) => (
                    <button
                      className={period === item.value ? 'active' : ''}
                      key={item.value}
                      onClick={() => {
                        setLoading(true)
                        setPeriod(item.value)
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="admin-chart-bars">
                {data.trend.map((item) => (
                  <div
                    className="admin-chart-bar admin-chart-bar--inactive"
                    key={item.label}
                    title={`${item.label}: ${formatCurrency(item.revenue)}`}
                    style={{ height: `${Math.max(3, (item.revenue / maxRevenue) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="admin-chart-labels">
                {data.trend.map((item) => <span key={item.label}>{item.label}</span>)}
              </div>
            </section>

            <section className="admin-kyc-card soft-elevation">
              <h3 className="admin-kyc-card__title">
                KYC chờ xử lý ({data.stats.pendingPartners})
              </h3>
              <div className="admin-kyc-list">
                {data.pendingPartners.length === 0 ? (
                  <EmptyState>Không có hồ sơ đang chờ.</EmptyState>
                ) : data.pendingPartners.map((partner) => (
                  <Link className="admin-kyc-item" to="/admin/kyc-approval" key={partner.id}>
                    <div className="admin-kyc-item__avatar-placeholder">
                      <span className="material-symbols-outlined">corporate_fare</span>
                    </div>
                    <div className="admin-kyc-item__info">
                      <p className="admin-kyc-item__name">{partner.businessName}</p>
                      <p className="admin-kyc-item__sub">{partner.user.email}</p>
                    </div>
                    <span className="material-symbols-outlined">arrow_forward</span>
                  </Link>
                ))}
              </div>
              <Link className="admin-kyc-view-all-btn" to="/admin/kyc-approval">
                Xem tất cả hồ sơ
              </Link>
            </section>
          </div>

          <section className="admin-attractions-section">
            <div className="admin-attractions-header">
              <h3>Điểm tham quan chờ duyệt</h3>
              <Link to="/admin/attraction-approval">
                Quản lý tất cả
                <span className="material-symbols-outlined">chevron_right</span>
              </Link>
            </div>
            {data.pendingAttractions.length === 0 ? (
              <div className="admin-page-section">
                <EmptyState>Không có điểm tham quan đang chờ duyệt.</EmptyState>
              </div>
            ) : (
              <div className="admin-attractions-grid">
                {data.pendingAttractions.map((attraction) => (
                  <Link
                    className="admin-attraction-card"
                    to="/admin/attraction-approval"
                    key={attraction.id}
                  >
                    <div className="admin-attraction-card__image-wrap">
                      {attraction.primaryImage ? (
                        <img loading="lazy" src={attraction.primaryImage} alt={attraction.title} />
                      ) : (
                        <div className="admin-empty-state">Chưa có ảnh</div>
                      )}
                      {attraction.minTicketPrice != null && (
                        <div className="admin-attraction-card__price-badge">
                          {formatCurrency(attraction.minTicketPrice)}
                        </div>
                      )}
                    </div>
                    <div className="admin-attraction-card__body">
                      <h4>{attraction.title}</h4>
                      <p>{attraction.city} · {attraction.partner.businessName}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </AdminLayout>
  )
}
