import { useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import '../../styles/admin.css';

// ── Static Mock Data ──────────────────────────────────────────────────────────

const INITIAL_CATEGORIES = [
  { id: 1, icon: '🌊', iconBg: 'rgba(0,96,104,0.1)',  name: 'Công viên nước', desc: 'Vui chơi giải trí dưới nước',   count: 42,  date: '12/05/2023', status: 'active' },
  { id: 2, icon: '🏛️', iconBg: 'rgba(124,88,0,0.1)', name: 'Bảo tàng',       desc: 'Lịch sử và văn hóa',            count: 28,  date: '15/05/2023', status: 'active' },
  { id: 3, icon: '🍜', iconBg: 'rgba(97,51,10,0.1)', name: 'Ẩm thực',        desc: 'Nhà hàng & Quán ăn địa phương', count: 156, date: '20/05/2023', status: 'active' },
  { id: 4, icon: '⛰️', iconBg: 'rgba(0,96,104,0.1)', name: 'Thiên nhiên',    desc: 'Cảnh quan & Danh lam',           count: 84,  date: '02/06/2023', status: 'active' },
  { id: 5, icon: '🎭', iconBg: 'rgba(124,88,0,0.1)', name: 'Nghệ thuật',     desc: 'Triển lãm & Show diễn',          count: 15,  date: '10/06/2023', status: 'hidden' },
];

const ICON_CHOICES = ['🌊','🏛️','🍜','⛰️','🎭','🎪','🏖️','🏝️','🌴','🗺️','🎡','🎢','🏯','⛩️','🕌'];
const BG_CHOICES   = [
  'rgba(0,96,104,0.1)', 'rgba(124,88,0,0.1)', 'rgba(97,51,10,0.1)',
  'rgba(59,130,246,0.1)', 'rgba(16,185,129,0.1)', 'rgba(239,68,68,0.1)',
];

let nextId = 100;

const DISTRIBUTION = [
  { label: 'Ẩm thực',   pct: 45, color: 'var(--adm-primary-dark)' },
  { label: 'Thiên nhiên', pct: 25, color: 'var(--adm-secondary)' },
  { label: 'Bảo tàng',  pct: 15, color: 'var(--adm-tertiary)' },
  { label: 'Khác',      pct: 15, color: 'var(--adm-outline-variant)' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`admin-toast admin-toast--visible admin-toast--${toast.type}`}>
      <span className="material-symbols-outlined">{toast.type === 'success' ? 'check_circle' : 'info'}</span>
      {toast.msg}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CategoryManagementPage() {
  const [categories, setCategories] = useState(INITIAL_CATEGORIES);
  const [toast, setToast] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('default');

  // ── Actions ────────────────────────────────────────────────────────────────

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  /** Add a new category via prompt() */
  function handleAdd() {
    const name = window.prompt('Nhập tên danh mục mới:', '');
    if (name === null) return;          // cancelled
    const trimmed = name.trim();
    if (!trimmed) {
      window.alert('Tên danh mục không được để trống!');
      return;
    }
    if (categories.some(c => c.name.toLowerCase() === trimmed.toLowerCase())) {
      window.alert(`Danh mục "${trimmed}" đã tồn tại!`);
      return;
    }

    const desc = window.prompt('Nhập mô tả ngắn:', '') ?? '';
    const icon = ICON_CHOICES[Math.floor(Math.random() * ICON_CHOICES.length)];
    const bg   = BG_CHOICES  [Math.floor(Math.random() * BG_CHOICES.length)];
    const today = new Date().toLocaleDateString('vi-VN');

    const newCat = {
      id: nextId++,
      icon,
      iconBg: bg,
      name: trimmed,
      desc: desc.trim() || 'Chưa có mô tả',
      count: 0,
      date: today,
      status: 'active',
    };
    setCategories(prev => [...prev, newCat]);
    showToast(`Đã thêm danh mục "${trimmed}"`, 'success');
  }

  /** Edit category name + description via prompt() */
  function handleEdit(cat) {
    const newName = window.prompt(`Chỉnh sửa tên danh mục:`, cat.name);
    if (newName === null) return;
    const trimmedName = newName.trim();
    if (!trimmedName) { window.alert('Tên không được để trống!'); return; }

    const newDesc = window.prompt('Chỉnh sửa mô tả:', cat.desc);
    if (newDesc === null) return;

    setCategories(prev =>
      prev.map(c =>
        c.id === cat.id ? { ...c, name: trimmedName, desc: newDesc.trim() || c.desc } : c,
      ),
    );
    showToast(`Đã cập nhật danh mục "${trimmedName}"`, 'success');
  }

  /** Delete category after confirm() */
  function handleDelete(cat) {
    const ok = window.confirm(
      `Bạn có chắc muốn xóa danh mục "${cat.name}" không?\n` +
      `Thao tác này không thể hoàn tác.`,
    );
    if (!ok) return;
    setCategories(prev => prev.filter(c => c.id !== cat.id));
    showToast(`Đã xóa danh mục "${cat.name}"`, 'error');
  }

  /** Toggle visibility status */
  function handleToggleStatus(cat) {
    const newStatus = cat.status === 'active' ? 'hidden' : 'active';
    setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, status: newStatus } : c));
    showToast(
      newStatus === 'hidden' ? `Đã ẩn danh mục "${cat.name}"` : `Đã hiển thị danh mục "${cat.name}"`,
      newStatus === 'hidden' ? 'error' : 'success',
    );
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const totalLocations = categories.reduce((sum, c) => sum + c.count, 0);
  const topCat         = categories.reduce((best, c) => (c.count > best.count ? c : best), categories[0] || {});
  const activeCount    = categories.filter(c => c.status === 'active').length;

  const CAT_STATS = [
    { id: 'total',  icon: 'category',     variant: 'approved', label: 'Tổng danh mục',       value: categories.length, sub: `${activeCount} đang hiển thị`, subColor: 'var(--adm-primary-dark)' },
    { id: 'top',    icon: 'stars',        variant: 'pending',  label: 'Địa điểm nhiều nhất', value: topCat.name ?? '—', sub: `${topCat.count ?? 0} địa điểm`, subColor: 'var(--adm-on-surface-variant)' },
    { id: 'views',  icon: 'trending_up',  variant: 'time',     label: 'Tổng địa điểm',       value: totalLocations, sub: '↑ 12% so với kỳ trước', subColor: 'var(--adm-primary-dark)' },
    { id: 'active', icon: 'check_circle', variant: 'approved', label: 'Đang hoạt động',      value: `${activeCount}/${categories.length}`, sub: 'Không có lỗi hệ thống', subColor: 'var(--adm-on-surface-variant)' },
  ];

  // Lọc danh mục theo trạng thái
  const filteredCategories = categories.filter(c => {
    if (filterStatus === 'all') return true;
    return c.status === filterStatus;
  });

  // Sắp xếp danh mục
  const displayedCategories = [...filteredCategories].sort((a, b) => {
    if (sortBy === 'name') {
      return a.name.localeCompare(b.name, 'vi');
    }
    if (sortBy === 'count') {
      return b.count - a.count;
    }
    if (sortBy === 'date') {
      const parseDate = (dStr) => {
        const [d, m, y] = dStr.split('/');
        return new Date(y, m - 1, d);
      };
      return parseDate(b.date) - parseDate(a.date);
    }
    return 0;
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm danh mục...">

      {/* Page Header */}
      <div className="admin-page-header">
        <div>
          <h2>Danh mục du lịch</h2>
          <p>Quản lý các phân loại địa điểm du lịch trên toàn hệ thống.</p>
        </div>
        <button className="admin-export-btn" onClick={handleAdd}>
          <span className="material-symbols-outlined">add</span>
          Thêm danh mục mới
        </button>
      </div>

      {/* Stats Grid */}
      <div className="admin-mini-stats-grid">
        {CAT_STATS.map(s => (
          <div className="admin-page-section" key={s.id} style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--adm-on-surface-variant)' }}>{s.label}</span>
              <div
                className={`admin-mini-stat__icon admin-mini-stat__icon--${s.variant}`}
                style={{ width: 36, height: 36 }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>{s.icon}</span>
              </div>
            </div>
            <div style={{ fontFamily: "'Be Vietnam Pro', sans-serif", fontSize: 20, fontWeight: 700 }}>{s.value}</div>
            <div style={{ fontSize: 12, marginTop: 4, color: s.subColor, fontWeight: 500 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="admin-page-section">
        {/* Table filter bar */}
        <div
          style={{
            padding: '14px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(190,200,202,0.2)',
            background: 'rgba(243,243,246,0.3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--adm-outline)' }}>filter_list</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--adm-on-surface-variant)' }}>Trạng thái:</span>
              <select
                value={filterStatus}
                onChange={e => setFilterStatus(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(190,200,202,0.5)',
                  background: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--adm-on-surface-variant)',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="all">Tất cả</option>
                <option value="active">Hiển thị</option>
                <option value="hidden">Đang ẩn</option>
              </select>
            </div>

            {/* Sort */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--adm-outline)' }}>sort</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--adm-on-surface-variant)' }}>Sắp xếp theo:</span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(190,200,202,0.5)',
                  background: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--adm-on-surface-variant)',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="default">Mặc định</option>
                <option value="name">Tên danh mục (A-Z)</option>
                <option value="count">Số địa điểm (Nhiều nhất)</option>
                <option value="date">Ngày tạo (Mới nhất)</option>
              </select>
            </div>
          </div>
          <span style={{ fontSize: 12, color: 'var(--adm-outline)' }}>
            Đang hiển thị {displayedCategories.length} / {categories.length} danh mục
          </span>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Icon</th>
                <th>Tên danh mục</th>
                <th>Số địa điểm</th>
                <th>Ngày tạo</th>
                <th>Trạng thái</th>
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {displayedCategories.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--adm-on-surface-variant)' }}>
                    Không tìm thấy danh mục phù hợp.
                  </td>
                </tr>
              )}
              {displayedCategories.map(cat => (
                <tr key={cat.id}>
                  {/* Icon */}
                  <td>
                    <div className="admin-cat-icon" style={{ background: cat.iconBg }}>
                      {cat.icon}
                    </div>
                  </td>

                  {/* Name + desc */}
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{cat.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--adm-outline)' }}>{cat.desc}</div>
                  </td>

                  {/* Count */}
                  <td>
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: 9999,
                        background: 'var(--adm-surface-container-high)',
                        color: 'var(--adm-primary-dark)',
                        fontWeight: 700,
                        fontSize: 12,
                      }}
                    >
                      {cat.count}
                    </span>
                  </td>

                  <td style={{ color: 'var(--adm-on-surface-variant)', fontSize: 12 }}>{cat.date}</td>

                  {/* Status */}
                  <td>
                    <button
                      onClick={() => handleToggleStatus(cat)}
                      title="Bấm để thay đổi trạng thái"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 10px',
                        borderRadius: 9999,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 600,
                        transition: 'opacity 150ms',
                        ...(cat.status === 'active'
                          ? { background: 'rgba(0,96,104,0.1)', color: 'var(--adm-primary-dark)' }
                          : { background: 'rgba(190,200,202,0.2)', color: 'var(--adm-outline)' }),
                      }}
                    >
                      <span
                        style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: cat.status === 'active' ? 'var(--adm-primary-dark)' : 'var(--adm-outline-variant)',
                        }}
                      />
                      {cat.status === 'active' ? 'Hiển thị' : 'Ẩn'}
                    </button>
                  </td>

                  {/* Actions */}
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
                      {/* Edit */}
                      <button
                        title="Sửa"
                        onClick={() => handleEdit(cat)}
                        style={{
                          padding: 8, color: 'var(--adm-primary-dark)',
                          background: 'transparent', border: 'none',
                          borderRadius: 8, cursor: 'pointer', transition: 'background 150ms',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,71,77,0.1)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>edit</span>
                      </button>

                      {/* Delete */}
                      <button
                        title="Xóa"
                        onClick={() => handleDelete(cat)}
                        style={{
                          padding: 8, color: 'var(--adm-error)',
                          background: 'transparent', border: 'none',
                          borderRadius: 8, cursor: 'pointer', transition: 'background 150ms',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(186,26,26,0.1)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="admin-pagination">
          <div className="admin-pagination__controls">
            <button className="admin-pagination__btn" disabled>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>first_page</span>
            </button>
            <button className="admin-pagination__btn" disabled>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span>
            </button>
            <button className="admin-pagination__btn active">1</button>
            <button className="admin-pagination__btn">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span>
            </button>
            <button className="admin-pagination__btn">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>last_page</span>
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--adm-outline)' }}>Đi tới trang</span>
            <input
              type="number"
              defaultValue={1}
              min={1}
              style={{
                width: 56, height: 32, borderRadius: 8,
                border: '1px solid rgba(190,200,202,0.5)',
                background: 'transparent', textAlign: 'center',
                fontSize: 12, fontWeight: 600,
              }}
            />
          </div>
        </div>
      </div>

      {/* Bento Grid: Distribution + Tip */}
      <div style={{ marginTop: 48, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        {/* Distribution */}
        <div className="admin-page-section" style={{ padding: 32, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <h3 style={{ fontFamily: "'Be Vietnam Pro', sans-serif", fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
              Cấu trúc phân bổ
            </h3>
            <p style={{ fontSize: 14, color: 'var(--adm-on-surface-variant)', marginBottom: 24, lineHeight: 1.6 }}>
              Biểu đồ thể hiện tỷ lệ phân bổ các danh mục đang hoạt động trên hệ thống du lịch VietTicket.
            </p>
            <div className="admin-distrib-bar">
              {DISTRIBUTION.map(d => (
                <div key={d.label} style={{ width: `${d.pct}%`, background: d.color }} title={`${d.label}: ${d.pct}%`} />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 16 }}>
              {DISTRIBUTION.filter(d => d.label !== 'Khác').map(d => (
                <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{d.label} ({d.pct}%)</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: 'absolute', right: -48, bottom: -48, opacity: 0.05 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 200, fontVariationSettings: "'FILL' 1" }}>pie_chart</span>
          </div>
        </div>

        {/* Tip card */}
        <div
          style={{
            background: 'var(--adm-primary-dark)',
            color: '#fff',
            padding: 32,
            borderRadius: 20,
            position: 'relative',
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,71,77,0.3)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h3 style={{ fontFamily: "'Be Vietnam Pro', sans-serif", fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
              Tối ưu hóa danh mục
            </h3>
            <p style={{ fontSize: 14, opacity: 0.8, lineHeight: 1.6, marginBottom: 24 }}>
              Đảm bảo các danh mục của bạn có icon đồng nhất và mô tả rõ ràng để tăng 35% tỷ lệ click từ người dùng.
            </p>
          </div>
          <button
            style={{
              width: '100%',
              padding: '12px 0',
              background: '#ffffff',
              color: 'var(--adm-primary-dark)',
              fontWeight: 700,
              border: 'none',
              borderRadius: 12,
              cursor: 'pointer',
              fontSize: 14,
              transition: 'background 150ms',
            }}
            onClick={handleAdd}
            onMouseEnter={e => { e.currentTarget.style.background = '#e0f7fa'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#ffffff'; }}
          >
            + Thêm danh mục mới
          </button>
          <div style={{ position: 'absolute', top: 16, right: 16, opacity: 0.2 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 40 }}>lightbulb</span>
          </div>
        </div>
      </div>

      <Toast toast={toast} />
    </AdminLayout>
  );
}
