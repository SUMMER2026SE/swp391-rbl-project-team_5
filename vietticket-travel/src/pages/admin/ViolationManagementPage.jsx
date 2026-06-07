import { useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import '../../styles/admin.css';

// ── Static Mock Data ──────────────────────────────────────────────────────────

const INITIAL_LOCATIONS = [
  {
    id: 1,
    name: 'Cầu Vàng Bà Nà Hills',
    location: 'Đà Nẵng',
    partner: 'Sun Group',
    category: 'Giải trí',
    rating: 4.9,
    reviews: '12k+',
    status: 'active',
    image: 'https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 2,
    name: 'Phố Cổ Hội An',
    location: 'Quảng Nam',
    partner: 'Local Explorer Ltd.',
    category: 'Văn hóa',
    rating: 4.7,
    reviews: '8.5k',
    status: 'active',
    image: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 3,
    name: 'Vịnh Hạ Long',
    location: 'Quảng Ninh',
    partner: 'VinWonders',
    category: 'Thiên nhiên',
    rating: 4.9,
    reviews: '25k+',
    status: 'active',
    image: 'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 4,
    name: 'Núi Bà Đen',
    location: 'Tây Ninh',
    partner: 'Sun Group',
    category: 'Thiên nhiên',
    rating: 4.6,
    reviews: '9.2k',
    status: 'hidden',
    image: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=400&q=80',
  },
];

const ALL_PARTNERS  = ['Tất cả đối tác',  'Sun Group', 'VinWonders', 'Local Explorer Ltd.'];
const ALL_CATS      = ['Tất cả danh mục', 'Giải trí',  'Văn hóa',   'Thiên nhiên'];
const ALL_STATUSES  = ['all', 'active', 'hidden'];
const STATUS_LABEL  = { all: 'Tất cả', active: 'Đang hoạt động', hidden: 'Đã ẩn' };

// ── Sub-components ────────────────────────────────────────────────────────────

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`admin-toast admin-toast--visible admin-toast--${toast.type}`}>
      <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
      {toast.msg}
    </div>
  );
}

function ConfirmModal({ target, onClose, onConfirm }) {
  if (!target) return null;
  const hiding = target.status === 'active';
  return (
    <div className="admin-modal-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()}>
        <div className="admin-modal__icon admin-modal__icon--warn">
          <span className="material-symbols-outlined" style={{ fontSize: 28, fontVariationSettings: "'FILL' 1" }}>warning</span>
        </div>
        <h3 className="admin-modal__title">
          {hiding ? 'Xác nhận tạm ẩn địa điểm' : 'Khôi phục địa điểm'}
        </h3>
        <p className="admin-modal__body">
          Bạn có chắc muốn <strong>{hiding ? 'ẩn' : 'khôi phục'}</strong> địa điểm{' '}
          <strong>{target.name}</strong> không?{' '}
          {hiding
            ? 'Hành động này sẽ khiến địa điểm không xuất hiện trên nền tảng người dùng.'
            : 'Địa điểm sẽ được hiển thị trở lại trên nền tảng.'}
        </p>
        <div className="admin-modal__actions">
          <button className="admin-modal__cancel" onClick={onClose}>Hủy bỏ</button>
          <button className="admin-modal__confirm" onClick={onConfirm}>
            {hiding ? 'Xác nhận ẩn' : 'Khôi phục'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ViolationManagementPage() {
  const [locations, setLocations] = useState(INITIAL_LOCATIONS);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [toast, setToast] = useState(null);

  // ── Filters ────────────────────────────────────────────────────────────────
  const [filterPartner,  setFilterPartner]  = useState('Tất cả đối tác');
  const [filterCategory, setFilterCategory] = useState('Tất cả danh mục');
  const [filterStatus,   setFilterStatus]   = useState('all');

  // ── Actions ────────────────────────────────────────────────────────────────

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleToggle(loc) { setConfirmTarget(loc); }
  function closeConfirm()    { setConfirmTarget(null); }

  function confirmToggle() {
    const { id, name, status } = confirmTarget;
    const newStatus = status === 'active' ? 'hidden' : 'active';
    setLocations(prev => prev.map(l => l.id === id ? { ...l, status: newStatus } : l));
    closeConfirm();
    showToast(
      newStatus === 'hidden'
        ? `Đã tạm ẩn địa điểm: ${name}`
        : `Đã khôi phục địa điểm: ${name}`,
      newStatus === 'hidden' ? 'error' : 'success',
    );
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const displayed = locations.filter(l => {
    const matchPartner  = filterPartner  === 'Tất cả đối tác'  || l.partner  === filterPartner;
    const matchCategory = filterCategory === 'Tất cả danh mục' || l.category === filterCategory;
    const matchStatus   = filterStatus   === 'all'              || l.status   === filterStatus;
    return matchPartner && matchCategory && matchStatus;
  });

  const activeCount = locations.filter(l => l.status === 'active').length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm địa điểm, đối tác...">

      {/* Page Header */}
      <div className="admin-page-header">
        <div>
          <h2 style={{ color: 'var(--adm-primary-dark)' }}>Quản lý vi phạm</h2>
          <p>Kiểm soát và tạm ẩn các địa điểm vi phạm quy chuẩn cộng đồng.</p>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 8,
            background: 'rgba(0,71,77,0.1)',
            color: 'var(--adm-primary-dark)',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          Đang hoạt động: {activeCount}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="admin-filter-bar">
        {/* Partner */}
        <div className="admin-filter-group">
          <label htmlFor="vioPartner">Đối tác</label>
          <select
            id="vioPartner"
            value={filterPartner}
            onChange={e => setFilterPartner(e.target.value)}
          >
            {ALL_PARTNERS.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>

        {/* Category */}
        <div className="admin-filter-group">
          <label htmlFor="vioCat">Danh mục</label>
          <select
            id="vioCat"
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
          >
            {ALL_CATS.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>

        {/* Status */}
        <div className="admin-filter-group" style={{ minWidth: 160 }}>
          <label htmlFor="vioStatus">Trạng thái</label>
          <select
            id="vioStatus"
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
          >
            {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>

        {/* Reset */}
        <button
          onClick={() => {
            setFilterPartner('Tất cả đối tác');
            setFilterCategory('Tất cả danh mục');
            setFilterStatus('all');
          }}
          style={{
            height: 46,
            padding: '0 20px',
            background: 'transparent',
            border: '1px solid rgba(190,200,202,0.5)',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            color: 'var(--adm-on-surface-variant)',
          }}
        >
          Đặt lại
        </button>
      </div>

      {/* Table */}
      <div className="admin-page-section">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Địa điểm</th>
                <th>Đối tác</th>
                <th>Danh mục</th>
                <th>Lượt đánh giá</th>
                <th>Trạng thái</th>
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--adm-on-surface-variant)' }}>
                    Không tìm thấy địa điểm nào.
                  </td>
                </tr>
              )}
              {displayed.map(loc => (
                <tr key={loc.id} style={{ opacity: loc.status === 'hidden' ? 0.65 : 1, transition: 'opacity 200ms' }}>
                  {/* Name + image */}
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <img
                        src={loc.image}
                        alt={loc.name}
                        style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }}
                      />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{loc.name}</div>
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--adm-on-surface-variant)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            marginTop: 2,
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>location_on</span>
                          {loc.location}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td style={{ color: 'rgba(26,28,30,0.8)' }}>{loc.partner}</td>

                  {/* Category */}
                  <td>
                    <span
                      style={{
                        padding: '4px 12px',
                        borderRadius: 9999,
                        fontSize: 12,
                        fontWeight: 600,
                        background: 'rgba(254,222,168,0.5)',
                        color: 'var(--adm-secondary)',
                      }}
                    >
                      {loc.category}
                    </span>
                  </td>

                  {/* Rating */}
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 18, color: 'var(--adm-secondary)', fontVariationSettings: "'FILL' 1" }}
                      >
                        star
                      </span>
                      <span style={{ fontWeight: 700, color: 'var(--adm-primary-dark)' }}>{loc.rating}</span>
                      <span style={{ fontSize: 12, color: 'var(--adm-on-surface-variant)' }}>({loc.reviews})</span>
                    </div>
                  </td>

                  {/* Status */}
                  <td>
                    {loc.status === 'active' ? (
                      <span className="badge badge--active">
                        <span className="badge__dot" style={{ background: 'var(--adm-primary-dark)' }} />
                        Hoạt động
                      </span>
                    ) : (
                      <span className="badge badge--hidden">
                        <span className="badge__dot" style={{ background: 'var(--adm-outline)' }} />
                        Đã ẩn
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td style={{ textAlign: 'right' }}>
                    {loc.status === 'active' ? (
                      <button className="btn-warn" onClick={() => handleToggle(loc)}>
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>visibility_off</span>
                        Tạm ẩn
                      </button>
                    ) : (
                      <button
                        onClick={() => handleToggle(loc)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '8px 16px',
                          borderRadius: 8,
                          background: 'rgba(0,71,77,0.1)',
                          color: 'var(--adm-primary-dark)',
                          border: 'none',
                          fontWeight: 600,
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>visibility</span>
                        Khôi phục
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="admin-pagination">
          <p className="admin-pagination__info">
            Hiển thị <strong>{displayed.length}</strong> / <strong>{locations.length}</strong> địa điểm
          </p>
          <div className="admin-pagination__controls">
            <button className="admin-pagination__btn" disabled>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span>
            </button>
            <button className="admin-pagination__btn active">1</button>
            <button className="admin-pagination__btn">2</button>
            <button className="admin-pagination__btn">3</button>
            <button className="admin-pagination__btn">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirm Modal */}
      <ConfirmModal
        target={confirmTarget}
        onClose={closeConfirm}
        onConfirm={confirmToggle}
      />

      <Toast toast={toast} />
    </AdminLayout>
  );
}
