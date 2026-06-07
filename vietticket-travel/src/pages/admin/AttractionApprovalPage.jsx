import { useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import '../../styles/admin.css';

// ── Static Mock Data ──────────────────────────────────────────────────────────

const INITIAL_ATTRACTIONS = [
  {
    id: 1,
    name: 'Tháp Chăm Po Sah Inư',
    location: 'Phan Thiết, Bình Thuận',
    partner: 'Vietnam Travel Corp',
    partnerId: 'PARTNER-882',
    category: 'Di tích lịch sử',
    date: '14/10/2023',
    description: 'Quần thể tháp Chăm cổ xưa nằm trên đồi Bà Nài, mang đậm nét kiến trúc Chăm Pa đặc trưng.',
    price: '50.000 ₫',
    status: 'pending',
    image: 'https://images.unsplash.com/photo-1568402102990-bc541580b59f?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 2,
    name: 'Khám phá Hang Sơn Đoòng',
    location: 'Quảng Bình',
    partner: 'Oxalis Adventure',
    partnerId: 'PARTNER-042',
    category: 'Thám hiểm',
    date: '15/10/2023',
    description: 'Hang động lớn nhất thế giới, tour thám hiểm 6 ngày 5 đêm với trải nghiệm độc đáo.',
    price: '70.000.000 ₫',
    status: 'pending',
    image: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 3,
    name: 'Show Ký Ức Hội An',
    location: 'Hội An, Quảng Nam',
    partner: 'Gami Group',
    partnerId: 'PARTNER-115',
    category: 'Nghệ thuật',
    date: '15/10/2023',
    description: 'Đại nhạc cảnh nghệ thuật tái hiện lịch sử 400 năm hình thành phố cổ Hội An.',
    price: '600.000 ₫',
    status: 'pending',
    image: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=400&q=80',
  },
  {
    id: 4,
    name: 'Vinpearl Safari Phú Quốc',
    location: 'Phú Quốc, Kiên Giang',
    partner: 'VinWonders',
    partnerId: 'PARTNER-999',
    category: 'Giải trí',
    date: '16/10/2023',
    description: 'Vườn thú bán hoang dã lớn nhất Đông Nam Á với hơn 3.000 động vật quý hiếm.',
    price: '850.000 ₫',
    status: 'approved',
    image: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=400&q=80',
  },
];

const STATUS_LABEL = { pending: 'PENDING', approved: 'APPROVED', rejected: 'REJECTED' };

const SYSTEM_STATS = [
  { id: 'pending',  icon: 'pending_actions', variant: 'pending',  label: 'Tổng chờ duyệt',    getter: list => list.filter(a => a.status === 'pending').length },
  { id: 'approved', icon: 'check_circle',    variant: 'approved', label: 'Đã duyệt (hôm nay)', getter: list => list.filter(a => a.status === 'approved').length },
  { id: 'rejected', icon: 'cancel',          variant: 'rejected', label: 'Đã từ chối',          getter: list => list.filter(a => a.status === 'rejected').length },
  { id: 'time',     icon: 'schedule',        variant: 'time',     label: 'TG phản hồi TB',      getter: () => '4.5h' },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`admin-toast admin-toast--visible admin-toast--${toast.type}`}>
      <span className="material-symbols-outlined">info</span>
      {toast.msg}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AttractionApprovalPage() {
  const [attractions, setAttractions] = useState(INITIAL_ATTRACTIONS);
  const [toast, setToast] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');

  // ── Actions ────────────────────────────────────────────────────────────────

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleApprove(id) {
    setAttractions(prev => prev.map(a => a.id === id ? { ...a, status: 'approved' } : a));
    const name = attractions.find(a => a.id === id)?.name;
    showToast(`Đã phê duyệt địa điểm: ${name}`, 'success');
  }

  function handleReject(id) {
    const name = attractions.find(a => a.id === id)?.name;
    const reason = window.prompt(`Lý do từ chối địa điểm "${name}":`, '');
    if (reason === null) return; // cancelled
    const trimmed = reason.trim() || 'Không có lý do cụ thể';
    setAttractions(prev =>
      prev.map(a => a.id === id ? { ...a, status: 'rejected', rejectReason: trimmed } : a),
    );
    showToast(`Đã từ chối địa điểm: ${name}`, 'error');
  }

  function handleViewDetail(attraction) {
    window.alert(
      `📍 ${attraction.name}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Vị trí   : ${attraction.location}\n` +
      `Đối tác  : ${attraction.partner} (${attraction.partnerId})\n` +
      `Danh mục : ${attraction.category}\n` +
      `Giá      : ${attraction.price}\n` +
      `Ngày gửi : ${attraction.date}\n` +
      `Trạng thái: ${STATUS_LABEL[attraction.status]}\n` +
      (attraction.status === 'rejected' ? `Lý do từ chối: ${attraction.rejectReason || 'Không rõ'}\n` : '') +
      `\nMô tả:\n${attraction.description}`,
    );
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const displayed = filterStatus === 'all'
    ? attractions
    : attractions.filter(a => a.status === filterStatus);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm địa điểm, đối tác...">

      {/* Page Header */}
      <div className="admin-page-header">
        <div>
          <h2>Phê duyệt địa điểm du lịch</h2>
          <p>Danh sách các địa điểm mới đang chờ được kiểm duyệt trước khi hiển thị công khai.</p>
        </div>

        {/* Status filter buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          {['all', 'pending', 'approved', 'rejected'].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                transition: 'all 150ms',
                borderColor: filterStatus === s ? 'var(--adm-primary-dark)' : 'rgba(190,200,202,0.5)',
                background: filterStatus === s ? 'var(--adm-primary-dark)' : 'transparent',
                color: filterStatus === s ? '#fff' : 'var(--adm-on-surface-variant)',
              }}
            >
              {s === 'all' ? 'Tất cả' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="admin-page-section">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Ảnh &amp; Tên địa điểm</th>
                <th>Đối tác đăng</th>
                <th>Danh mục</th>
                <th>Ngày gửi</th>
                <th>Trạng thái</th>
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--adm-on-surface-variant)' }}>
                    Không có địa điểm nào.
                  </td>
                </tr>
              )}
              {displayed.map(a => (
                <tr key={a.id}>
                  {/* Thumbnail + name */}
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div
                        style={{
                          width: 64,
                          height: 48,
                          borderRadius: 8,
                          overflow: 'hidden',
                          flexShrink: 0,
                          boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                        }}
                      >
                        <img
                          src={a.image}
                          alt={a.name}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            transition: 'transform 0.4s ease',
                          }}
                          onMouseEnter={e => { e.target.style.transform = 'scale(1.08)'; }}
                          onMouseLeave={e => { e.target.style.transform = 'scale(1)'; }}
                        />
                      </div>
                      <div>
                        <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>{a.name}</p>
                        <p
                          style={{
                            fontSize: 12,
                            color: 'var(--adm-on-surface-variant)',
                            margin: '2px 0 0',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>location_on</span>
                          {a.location}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Partner */}
                  <td>
                    <div style={{ fontWeight: 600 }}>{a.partner}</div>
                    <div style={{ fontSize: 12, color: 'var(--adm-on-surface-variant)' }}>ID: {a.partnerId}</div>
                  </td>

                  {/* Category */}
                  <td>
                    <span
                      style={{
                        background: 'rgba(0,96,104,0.1)',
                        color: 'var(--adm-primary-dark)',
                        padding: '4px 12px',
                        borderRadius: 9999,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {a.category}
                    </span>
                  </td>

                  <td>{a.date}</td>

                  {/* Status */}
                  <td>
                    {a.status === 'pending' ? (
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          color: 'var(--adm-secondary)',
                          fontWeight: 700,
                          fontSize: 12,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: 'var(--adm-secondary)',
                          }}
                        />
                        Đang chờ duyệt
                      </span>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span className={`badge badge--${a.status}`}>
                          <span className="badge__dot" />
                          {STATUS_LABEL[a.status]}
                        </span>
                        {a.status === 'rejected' && a.rejectReason && (
                          <span style={{ fontSize: 11, color: 'var(--adm-error)', maxWidth: 150, wordBreak: 'break-word' }}>
                            Lý do: {a.rejectReason}
                          </span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Actions */}
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      {/* View detail always visible */}
                      <button
                        onClick={() => handleViewDetail(a)}
                        title="Xem chi tiết"
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid rgba(190,200,202,0.5)',
                          background: 'transparent',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--adm-on-surface-variant)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          transition: 'background 150ms',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--adm-surface-container-high)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>info</span>
                        Chi tiết
                      </button>

                      {/* Approve / Reject only for pending */}
                      {a.status === 'pending' && (
                        <>
                          <button className="btn-approve" onClick={() => handleApprove(a.id)}>
                            Phê duyệt
                          </button>
                          <button className="btn-reject" onClick={() => handleReject(a.id)}>
                            Từ chối
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="admin-pagination">
          <span className="admin-pagination__info">
            Hiển thị <strong>{displayed.length}</strong> / <strong>{attractions.length}</strong> địa điểm
          </span>
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
        </div>
      </div>

      {/* System Stats */}
      <div className="admin-mini-stats-grid" style={{ marginTop: 32, marginBottom: 0 }}>
        {SYSTEM_STATS.map(s => (
          <div className="admin-mini-stat" key={s.id}>
            <div className={`admin-mini-stat__icon admin-mini-stat__icon--${s.variant}`}>
              <span className="material-symbols-outlined">{s.icon}</span>
            </div>
            <div>
              <p className="admin-mini-stat__label">{s.label}</p>
              <p className="admin-mini-stat__value">{s.getter(attractions)}</p>
            </div>
          </div>
        ))}
      </div>

      <Toast toast={toast} />
    </AdminLayout>
  );
}
