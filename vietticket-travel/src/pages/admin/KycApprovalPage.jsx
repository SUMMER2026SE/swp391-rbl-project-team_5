import { useState } from 'react';
import AdminLayout from '../../layouts/AdminLayout';
import '../../styles/admin.css';

// ── Static Mock Data ──────────────────────────────────────────────────────────

const INITIAL_PARTNERS = [
  {
    id: 1,
    name: 'Đà Nẵng Discovery Tours',
    email: 'contact@dndiscovery.vn',
    phone: '0905 123 456',
    date: '24/10/2023',
    status: 'pending',
    rejectReason: '',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=128&h=128&q=80',
  },
  {
    id: 2,
    name: 'Hạ Long Cruise Co.',
    email: 'info@halongcruise.vn',
    phone: '0203 999 888',
    date: '23/10/2023',
    status: 'pending',
    rejectReason: '',
    avatar: 'https://images.unsplash.com/photo-1544735716-392fe2489ffa?auto=format&fit=crop&w=128&h=128&q=80',
  },
  {
    id: 3,
    name: 'Bảo tàng Cố đô Huế',
    email: 'admin@hue-heritage.gov.vn',
    phone: '0234 555 666',
    date: '22/10/2023',
    status: 'pending',
    rejectReason: '',
    avatar: 'https://images.unsplash.com/photo-1568402102990-bc541580b59f?auto=format&fit=crop&w=128&h=128&q=80',
  },
  {
    id: 4,
    name: 'Sài Gòn Heritage Tours',
    email: 'hello@sgheritage.vn',
    phone: '0281 234 567',
    date: '21/10/2023',
    status: 'approved',
    rejectReason: '',
    avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=128&h=128&q=80',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABEL = { pending: 'PENDING', approved: 'APPROVED', rejected: 'REJECTED' };

function computeStats(partners) {
  return {
    pending:  partners.filter(p => p.status === 'pending').length,
    approved: partners.filter(p => p.status === 'approved').length,
    rejected: partners.filter(p => p.status === 'rejected').length,
    total:    partners.length,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`admin-toast admin-toast--visible admin-toast--${toast.type}`}>
      <span className="material-symbols-outlined">
        {toast.type === 'success' ? 'check_circle' : 'info'}
      </span>
      {toast.msg}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function KycApprovalPage() {
  const [partners, setPartners] = useState(INITIAL_PARTNERS);
  const [toast, setToast] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');

  // ── Actions ────────────────────────────────────────────────────────────────

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  function handleApprove(id) {
    setPartners(prev =>
      prev.map(p => p.id === id ? { ...p, status: 'approved', rejectReason: '' } : p),
    );
    showToast('Đã phê duyệt hồ sơ thành công!', 'success');
  }

  function handleReject(id, name) {
    const reason = window.prompt(`Lý do từ chối hồ sơ của "${name}":`, '');
    if (reason === null) return; // cancelled
    const trimmed = reason.trim() || 'Không rõ lý do';
    setPartners(prev =>
      prev.map(p => p.id === id ? { ...p, status: 'rejected', rejectReason: trimmed } : p),
    );
    showToast(`Đã từ chối hồ sơ: ${name}`, 'error');
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const stats = computeStats(partners);

  const displayed = filterStatus === 'all'
    ? partners
    : partners.filter(p => p.status === filterStatus);

  const STAT_CARDS = [
    { id: 'pending',  icon: 'pending_actions', variant: 'pending',  label: 'Đang chờ duyệt', value: stats.pending },
    { id: 'approved', icon: 'check_circle',    variant: 'approved', label: 'Đã phê duyệt',   value: stats.approved },
    { id: 'rejected', icon: 'cancel',          variant: 'rejected', label: 'Bị từ chối',      value: stats.rejected },
    { id: 'total',    icon: 'group',           variant: 'total',    label: 'Tổng đối tác',    value: stats.total },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm hồ sơ...">

      {/* Page Header */}
      <div className="admin-page-header">
        <div>
          <h2 style={{ color: 'var(--adm-primary-dark)' }}>Duyệt hồ sơ Đối tác (KYC)</h2>
          <p>Danh sách các đối tác mới đăng ký đang chờ xác thực thông tin pháp lý.</p>
        </div>

        {/* Filter by status */}
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

      {/* Stats */}
      <div className="admin-mini-stats-grid">
        {STAT_CARDS.map(s => (
          <div className="admin-mini-stat" key={s.id}>
            <div className={`admin-mini-stat__icon admin-mini-stat__icon--${s.variant}`}>
              <span className="material-symbols-outlined">{s.icon}</span>
            </div>
            <div>
              <p className="admin-mini-stat__label">{s.label}</p>
              <p className="admin-mini-stat__value">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="admin-page-section">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Tên Đối Tác</th>
                <th>Thông Tin Liên Hệ</th>
                <th>Ngày Đăng Ký</th>
                <th>Trạng Thái</th>
                <th>Lý Do Từ Chối</th>
                <th style={{ textAlign: 'right' }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--adm-on-surface-variant)' }}>
                    Không có hồ sơ nào.
                  </td>
                </tr>
              )}
              {displayed.map(p => (
                <tr key={p.id}>
                  {/* Partner name + avatar */}
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 48, height: 48, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
                        <img
                          src={p.avatar}
                          alt={p.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                    </div>
                  </td>

                  {/* Contact */}
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 500 }}>{p.email}</span>
                      <span style={{ fontSize: 12, color: 'var(--adm-on-surface-variant)' }}>{p.phone}</span>
                    </div>
                  </td>

                  <td>{p.date}</td>

                  {/* Status badge */}
                  <td>
                    <span className={`badge badge--${p.status}`}>
                      <span className="badge__dot" />
                      {STATUS_LABEL[p.status]}
                    </span>
                  </td>

                  {/* Reject reason */}
                  <td style={{ fontSize: 12, color: 'var(--adm-error)', maxWidth: 200, wordBreak: 'break-word' }}>
                    {p.status === 'rejected' ? p.rejectReason : '—'}
                  </td>

                  {/* Actions */}
                  <td style={{ textAlign: 'right' }}>
                    {p.status === 'pending' ? (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <button className="btn-approve" onClick={() => handleApprove(p.id)}>
                          Phê duyệt
                        </button>
                        <button className="btn-reject" onClick={() => handleReject(p.id, p.name)}>
                          Từ chối
                        </button>
                      </div>
                    ) : (
                      <span className={`badge badge--${p.status}`}>{STATUS_LABEL[p.status]}</span>
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
            Hiển thị <strong>{displayed.length}</strong> / <strong>{partners.length}</strong> hồ sơ
          </p>
          <div className="admin-pagination__controls">
            <button className="admin-pagination__btn" disabled>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span>
            </button>
            <button className="admin-pagination__btn active">1</button>
            <button className="admin-pagination__btn">
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* Info cards */}
      <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Guide */}
        <div
          style={{
            background: 'rgba(0,71,77,0.05)',
            borderRadius: 16,
            padding: 32,
            border: '1px solid rgba(0,71,77,0.1)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'relative', zIndex: 1 }}>
            <h4
              style={{
                fontFamily: "'Be Vietnam Pro', sans-serif",
                fontSize: 18,
                fontWeight: 600,
                color: 'var(--adm-primary-dark)',
                marginBottom: 8,
              }}
            >
              Hướng dẫn phê duyệt
            </h4>
            <p style={{ fontSize: 14, color: 'var(--adm-on-surface-variant)', lineHeight: 1.6 }}>
              Đảm bảo kiểm tra kỹ các giấy tờ pháp lý và giấy phép kinh doanh lữ hành trước khi
              nhấn nút phê duyệt hồ sơ đối tác.
            </p>
            <button
              style={{
                marginTop: 16,
                background: 'none',
                border: 'none',
                color: 'var(--adm-primary-dark)',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 14,
              }}
            >
              Xem quy trình chuẩn KYC
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>open_in_new</span>
            </button>
          </div>
          <div style={{ position: 'absolute', right: -40, bottom: -40, opacity: 0.08 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 160 }}>verified_user</span>
          </div>
        </div>

        {/* Recent activity */}
        <div className="admin-page-section" style={{ padding: 24 }}>
          <h4 style={{ fontFamily: "'Be Vietnam Pro', sans-serif", fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
            Tóm tắt trạng thái
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {partners.filter(p => p.status !== 'pending').map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: p.status === 'approved' ? 'rgba(16,185,129,0.1)' : 'rgba(186,26,26,0.1)',
                    color: p.status === 'approved' ? '#10b981' : 'var(--adm-error)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    {p.status === 'approved' ? 'check' : 'close'}
                  </span>
                </div>
                <div>
                  <p style={{ fontSize: 13, margin: 0, fontWeight: 500 }}>{p.name}</p>
                  <p style={{ fontSize: 11, color: 'var(--adm-on-surface-variant)', margin: '2px 0 0' }}>
                    {p.status === 'approved' ? 'Đã phê duyệt' : `Từ chối: ${p.rejectReason}`}
                  </p>
                </div>
              </div>
            ))}
            {partners.filter(p => p.status !== 'pending').length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--adm-on-surface-variant)' }}>Chưa có hành động nào.</p>
            )}
          </div>
        </div>
      </div>

      <Toast toast={toast} />
    </AdminLayout>
  );
}
