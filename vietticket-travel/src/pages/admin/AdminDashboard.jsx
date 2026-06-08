import { useState } from 'react';
import { Link } from 'react-router-dom';
import AdminLayout from '../../layouts/AdminLayout';
import '../../styles/admin.css';

// ── Static Sample Data ─────────────────────────────────────────────────────

const STATS_BY_PERIOD = {
  'Tuần': [
    { id: 'revenue', icon: 'payments', iconVariant: 'primary', label: 'Tổng doanh thu', value: '1.240.000.000₫', badge: '+12%', badgeType: 'up', badgeIcon: 'trending_up' },
    { id: 'locations', icon: 'map', iconVariant: 'secondary', label: 'Số lượng địa điểm', value: '156', badge: '+5', badgeType: 'up', badgeIcon: 'trending_up' },
    { id: 'partners', icon: 'person_add', iconVariant: 'tertiary', label: 'Số đối tác mới', value: '24', badge: '-2%', badgeType: 'down', badgeIcon: 'trending_down' },
    { id: 'conversion', icon: 'conversion_path', iconVariant: 'primary', label: 'Tỷ lệ chuyển đổi', value: '4.2%', badge: '+0.4%', badgeType: 'up', badgeIcon: 'trending_up' },
  ],
  'Tháng': [
    { id: 'revenue', icon: 'payments', iconVariant: 'primary', label: 'Tổng doanh thu', value: '5.890.000.000₫', badge: '+18%', badgeType: 'up', badgeIcon: 'trending_up' },
    { id: 'locations', icon: 'map', iconVariant: 'secondary', label: 'Số lượng địa điểm', value: '172', badge: '+18', badgeType: 'up', badgeIcon: 'trending_up' },
    { id: 'partners', icon: 'person_add', iconVariant: 'tertiary', label: 'Số đối tác mới', value: '98', badge: '+15%', badgeType: 'up', badgeIcon: 'trending_up' },
    { id: 'conversion', icon: 'conversion_path', iconVariant: 'primary', label: 'Tỷ lệ chuyển đổi', value: '4.5%', badge: '+0.8%', badgeType: 'up', badgeIcon: 'trending_up' },
  ],
  'Năm': [
    { id: 'revenue', icon: 'payments', iconVariant: 'primary', label: 'Tổng doanh thu', value: '64.500.000.000₫', badge: '+25%', badgeType: 'up', badgeIcon: 'trending_up' },
    { id: 'locations', icon: 'map', iconVariant: 'secondary', label: 'Số lượng địa điểm', value: '240', badge: '+86', badgeType: 'up', badgeIcon: 'trending_up' },
    { id: 'partners', icon: 'person_add', iconVariant: 'tertiary', label: 'Số đối tác mới', value: '350', badge: '+40%', badgeType: 'up', badgeIcon: 'trending_up' },
    { id: 'conversion', icon: 'conversion_path', iconVariant: 'primary', label: 'Tỷ lệ chuyển đổi', value: '4.8%', badge: '+1.2%', badgeType: 'up', badgeIcon: 'trending_up' },
  ]
};

const CHART_DATA = {
  'Tuần': [
    { day: 'T2', heightPct: 40, label: '320tr', isActive: false },
    { day: 'T3', heightPct: 60, label: '480tr', isActive: false },
    { day: 'T4', heightPct: 50, label: '400tr', isActive: false },
    { day: 'T5', heightPct: 85, label: '680tr', isActive: false },
    { day: 'T6', heightPct: 100, label: '800tr', isActive: false },
    { day: 'T7', heightPct: 90, label: '720tr', isActive: false },
    { day: 'CN (Nay)', heightPct: 55, label: '440tr (Lũy kế)', isActive: true },
  ],
  'Tháng': [
    { day: 'Th1', heightPct: 60, label: '1.2 tỷ', isActive: false },
    { day: 'Th2', heightPct: 50, label: '1.0 tỷ', isActive: false },
    { day: 'Th3', heightPct: 75, label: '1.5 tỷ', isActive: false },
    { day: 'Th4', heightPct: 85, label: '1.7 tỷ', isActive: false },
    { day: 'Th5', heightPct: 100, label: '2.0 tỷ', isActive: false },
    { day: 'Th6 (Nay)', heightPct: 25, label: '450tr (Lũy kế)', isActive: true },
  ],
  'Năm': [
    { day: '2023', heightPct: 55, label: '35 tỷ', isActive: false },
    { day: '2024', heightPct: 75, label: '48 tỷ', isActive: false },
    { day: '2025', heightPct: 100, label: '62 tỷ', isActive: false },
    { day: '2026 (Nay)', heightPct: 45, label: '28 tỷ (Lũy kế)', isActive: true },
  ]
};


const KYC_ITEMS = [
  {
    id: 1,
    name: 'Nguyễn Văn An',
    sub: 'Hướng dẫn viên - Đà Nẵng',
    avatarSrc: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=128&h=128&q=80',
    isCompany: false,
  },
  {
    id: 2,
    name: 'Trần Thị Bích',
    sub: 'Homestay "Mây Ngàn" - Sa Pa',
    avatarSrc: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=128&h=128&q=80',
    isCompany: false,
  },
  {
    id: 3,
    name: 'Linh Dan Travel',
    sub: 'Doanh nghiệp Lữ hành',
    avatarSrc: null,
    isCompany: true,
  },
];

const ATTRACTIONS = [
  {
    id: 1,
    title: 'Du thuyền vịnh Hạ Long',
    location: 'Quảng Ninh, Việt Nam',
    price: '850.000₫',
    photoCount: 12,
    status: 'Chờ duyệt',
    reviewers: [
      { initials: 'NV', variant: 'primary' },
      { initials: 'TD', variant: 'secondary' },
    ],
    imageSrc: 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 2,
    title: 'Tour lồng đèn phố cổ',
    location: 'Hội An, Quảng Nam',
    price: '120.000₫',
    photoCount: 8,
    status: 'Chờ duyệt',
    reviewers: [{ initials: 'HA', variant: 'tertiary' }],
    imageSrc: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 3,
    title: 'Cầu Vàng Bà Nà Hills',
    location: 'Đà Nẵng, Việt Nam',
    price: '900.000₫',
    photoCount: 24,
    status: 'Chờ duyệt',
    reviewers: [
      { initials: 'DN', variant: 'primary' },
      { initials: '+3', variant: 'neutral' },
    ],
    imageSrc: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=400&q=80',
  },
];

// ── Sub-components ─────────────────────────────────────────────────────────

/** Single stat card */
function StatCard({ icon, iconVariant, label, value, badge, badgeType, badgeIcon }) {
  return (
    <div className="admin-stat-card soft-elevation">
      <div className="admin-stat-card__top">
        <div className={`admin-stat-card__icon-wrap admin-stat-card__icon-wrap--${iconVariant}`}>
          <span className={`material-symbols-outlined icon--${iconVariant}`}>{icon}</span>
        </div>
        <span className={`admin-stat-card__badge admin-stat-card__badge--${badgeType}`}>
          {badge}
          <span className="material-symbols-outlined">{badgeIcon}</span>
        </span>
      </div>
      <p className="admin-stat-card__label">{label}</p>
      <p className="admin-stat-card__value">{value}</p>
    </div>
  );
}

/** Bar chart bar */
function ChartBar({ heightPct, label, isActive, onClick }) {
  return (
    <div
      className={`admin-chart-bar ${isActive ? 'admin-chart-bar--active' : 'admin-chart-bar--inactive'}`}
      style={{ height: `${heightPct}%` }}
      onClick={onClick}
    >
      {label && (
        <div className={`admin-chart-bar__tooltip${isActive ? '' : ' admin-chart-bar__tooltip--hidden'}`}>
          {label}
        </div>
      )}
    </div>
  );
}

/** KYC pending item */
function KycItem({ name, sub, avatarSrc, isCompany }) {
  return (
    <Link to="/admin/kyc-approval" className="admin-kyc-item" style={{ textDecoration: 'none', color: 'inherit' }}>
      {isCompany ? (
        <div className="admin-kyc-item__avatar-placeholder">
          <span className="material-symbols-outlined">corporate_fare</span>
        </div>
      ) : (
        <img className="admin-kyc-item__avatar" src={avatarSrc} alt={name} />
      )}
      <div className="admin-kyc-item__info">
        <p className="admin-kyc-item__name">{name}</p>
        <p className="admin-kyc-item__sub">{sub}</p>
      </div>
      <div className="admin-kyc-item__arrow">
        <span className="material-symbols-outlined">arrow_forward</span>
      </div>
    </Link>
  );
}

/** Attraction card */
function AttractionCard({ title, location, price, photoCount, status, reviewers, imageSrc }) {
  return (
    <Link to="/admin/attraction-approval" className="admin-attraction-card" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="admin-attraction-card__image-wrap">
        <img src={imageSrc} alt={title} />
        <div className="admin-attraction-card__photo-badge">
          <span className="material-symbols-outlined">image</span>
          {photoCount} Ảnh
        </div>
        <div className="admin-attraction-card__price-badge">{price}</div>
      </div>
      <div className="admin-attraction-card__body">
        <div className="admin-attraction-card__title-row">
          <h5>{title}</h5>
          <span className="admin-attraction-card__status-badge">{status}</span>
        </div>
        <div className="admin-attraction-card__location">
          <span className="material-symbols-outlined">location_on</span>
          <span>{location}</span>
        </div>
        <div className="admin-attraction-card__footer">
          <div className="admin-attraction-card__reviewers">
            {reviewers.map((r, i) => (
              <div
                key={i}
                className={`admin-attraction-card__reviewer-avatar admin-attraction-card__reviewer-avatar--${r.variant}`}
              >
                {r.initials}
              </div>
            ))}
          </div>
          <div className="admin-attraction-card__actions" onClick={(e) => e.preventDefault()}>
            <div className="admin-action-btn admin-action-btn--reject" title="Từ chối">
              <span className="material-symbols-outlined">close</span>
            </div>
            <div className="admin-action-btn admin-action-btn--approve" title="Phê duyệt">
              <span className="material-symbols-outlined">check</span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Main Page Component ────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [activePeriod, setActivePeriod] = useState('Tuần');
  const [selectedBar, setSelectedBar] = useState(null);

  const periods = ['Tuần', 'Tháng', 'Năm'];

  const handleExport = () => {
    alert("📥 Hệ thống đang tổng hợp dữ liệu và xuất báo cáo dưới dạng Excel/PDF. Quá trình tải xuống sẽ bắt đầu trong giây lát!");
  };

  const handlePeriodChange = (period) => {
    setActivePeriod(period);
    setSelectedBar(null); // Reset selection when period changes
  };

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm hệ thống...">


      {/* Page Header */}
      <div className="admin-page-header">
        <div>
          <h2>Tổng quan hệ thống</h2>
          <p>Chào mừng trở lại! Dưới đây là hoạt động mới nhất trong 24 giờ qua.</p>
        </div>
        <button className="admin-export-btn" onClick={handleExport}>
          <span className="material-symbols-outlined">download</span>
          Xuất báo cáo
        </button>
      </div>

      {/* ── Stat Cards ── */}
      <div className="admin-stats-grid">
        {STATS_BY_PERIOD[activePeriod].map((stat) => (
          <StatCard key={stat.id} {...stat} />
        ))}
      </div>

      {/* ── Visualization Section ── */}
      <div className="admin-viz-grid">
        {/* Revenue Chart */}
        <div className="admin-chart-card soft-elevation">
          <div className="admin-chart-card__header">
            <h4 className="admin-chart-card__title">Xu hướng Doanh thu</h4>
            <div className="admin-chart-period-toggle">
              {periods.map((p) => (
                <button
                  key={p}
                  className={activePeriod === p ? 'active' : ''}
                  onClick={() => handlePeriodChange(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="admin-chart-bars">
            {CHART_DATA[activePeriod].map((bar) => {
              const isActive = selectedBar 
                ? bar.day === selectedBar 
                : bar.isActive;
              return (
                <ChartBar 
                  key={bar.day} 
                  {...bar} 
                  isActive={isActive}
                  onClick={() => setSelectedBar(bar.day)}
                />
              );
            })}
          </div>

          <div className="admin-chart-labels">
            {CHART_DATA[activePeriod].map((bar) => {
              const isActive = selectedBar 
                ? bar.day === selectedBar 
                : bar.isActive;
              return (
                <span 
                  key={bar.day} 
                  className={isActive ? 'current' : ''}
                  onClick={() => setSelectedBar(bar.day)}
                  style={{ cursor: 'pointer' }}
                >
                  {bar.day}
                </span>
              );
            })}
          </div>
        </div>

        {/* KYC Pending */}
        <div className="admin-kyc-card soft-elevation">
          <h4 className="admin-kyc-card__title">Duyệt KYC chờ xử lý</h4>
          <div className="admin-kyc-list">
            {KYC_ITEMS.map((item) => (
              <KycItem key={item.id} {...item} />
            ))}
          </div>
          <Link to="/admin/kyc-approval" className="admin-kyc-view-all-btn" style={{ textDecoration: 'none', textAlign: 'center', display: 'block' }}>
            Xem tất cả (12 yêu cầu)
          </Link>
        </div>
      </div>

      {/* ── Attractions Section ── */}
      <div className="admin-attractions-section">
        <div className="admin-attractions-header">
          <h4>Địa điểm mới đăng ký</h4>
          <Link to="/admin/attraction-approval">
            Quản lý tất cả
            <span className="material-symbols-outlined">chevron_right</span>
          </Link>
        </div>

        <div className="admin-attractions-grid">
          {ATTRACTIONS.map((attraction) => (
            <AttractionCard key={attraction.id} {...attraction} />
          ))}
        </div>
      </div>

    </AdminLayout>
  );
}
