import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import AdminLayout from '../../layouts/AdminLayout';
import * as adminApi from '../../services/adminApi.js';
import '../../styles/admin.css';

const STATUS_LABEL = {
  pending: 'PENDING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  suspended: 'SUSPENDED',
};

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN').format(new Date(value));
}

function mapPartner(partner) {
  return {
    id: partner.id,
    name: partner.businessName,
    representative: partner.user?.fullName || '',
    email: partner.user?.email || '—',
    phone: partner.user?.profile?.phoneNumber || 'Chưa cập nhật',
    date: formatDate(partner.createdAt),
    status: String(partner.status || 'PENDING').toLowerCase(),
    rejectReason: partner.rejectionReason || '',
    businessLicenseUrl: partner.businessLicenseUrl || '',
  };
}

function computeStats(partners) {
  return {
    pending: partners.filter((partner) => partner.status === 'pending').length,
    approved: partners.filter((partner) => partner.status === 'approved').length,
    rejected: partners.filter((partner) => partner.status === 'rejected').length,
    total: partners.length,
  };
}

export default function KycApprovalPage() {
  const [partners, setPartners] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState('');

  useEffect(() => {
    let active = true;

    async function loadPartners() {
      setLoading(true);
      try {
        const result = await adminApi.listPartners();
        if (active) setPartners((result.data || []).map(mapPartner));
      } catch (error) {
        if (active) toast.error(error.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadPartners();
    return () => {
      active = false;
    };
  }, []);

  async function handleApprove(id) {
    setActionId(id);
    try {
      await adminApi.reviewPartner(id, 'APPROVED');
      setPartners((current) =>
        current.map((partner) =>
          partner.id === id
            ? { ...partner, status: 'approved', rejectReason: '' }
            : partner,
        ),
      );
      toast.success('Đã phê duyệt hồ sơ thành công!');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setActionId('');
    }
  }

  async function handleReject(id, name) {
    const reason = window.prompt(`Lý do từ chối hồ sơ của "${name}":`, '');
    if (reason === null) return;

    const rejectionReason = reason.trim();
    if (!rejectionReason) {
      toast.error('Vui lòng nhập lý do từ chối.');
      return;
    }

    setActionId(id);
    try {
      await adminApi.reviewPartner(id, 'REJECTED', rejectionReason);
      setPartners((current) =>
        current.map((partner) =>
          partner.id === id
            ? { ...partner, status: 'rejected', rejectReason: rejectionReason }
            : partner,
        ),
      );
      toast.error(`Đã từ chối hồ sơ của: ${name}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setActionId('');
    }
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
      <Toast toast={toast} />

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
              {displayed.map((partner) => (
                <tr key={partner.id}>
                  {/* Partner name */}
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 8,
                          flexShrink: 0,
                          background: 'rgba(0,96,104,0.1)',
                          color: 'var(--adm-primary-dark)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                        }}
                      >
                        {partner.name?.charAt(0)?.toUpperCase() || 'P'}
                      </div>
                      <div>
                        {partner.businessLicenseUrl ? (
                          <a
                            href={partner.businessLicenseUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontWeight: 600, color: 'var(--adm-primary-dark)' }}
                          >
                            {partner.name}
                          </a>
                        ) : (
                          <span style={{ fontWeight: 600 }}>{partner.name}</span>
                        )}
                        {partner.representative && (
                          <div style={{ fontSize: 12, color: 'var(--adm-on-surface-variant)', marginTop: 2 }}>
                            Đại diện: {partner.representative}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 500 }}>{partner.email}</span>
                      <span style={{ fontSize: 12, color: 'var(--adm-on-surface-variant)' }}>{partner.phone}</span>
                    </div>
                  </td>
                  <td>{partner.date}</td>
                  <td>
                    <span className={`badge badge--${partner.status}`}>
                      <span className="badge__dot" />
                      {STATUS_LABEL[partner.status] || partner.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--adm-error)', maxWidth: 200, wordBreak: 'break-word' }}>
                    {partner.status === 'rejected' ? partner.rejectReason : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {partner.status === 'pending' ? (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <button
                          className="btn-approve"
                          disabled={actionId === partner.id}
                          onClick={() => handleApprove(partner.id)}
                        >
                          {actionId === partner.id ? 'Đang xử lý...' : 'Phê duyệt'}
                        </button>
                        <button
                          className="btn-reject"
                          disabled={actionId === partner.id}
                          onClick={() => handleReject(partner.id, partner.name)}
                        >
                          Từ chối
                        </button>
                      </div>
                    ) : (
                      <span className={`badge badge--${partner.status}`}>
                        {STATUS_LABEL[partner.status] || partner.status.toUpperCase()}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="admin-pagination">
          <p className="admin-pagination__info">
            Hiển thị <strong>{displayed.length}</strong> / <strong>{partners.length}</strong> hồ sơ
          </p>
          <div className="admin-pagination__controls">
            <button className="admin-pagination__btn" disabled>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span>
            </button>
            <button className="admin-pagination__btn active">1</button>
            <button className="admin-pagination__btn" disabled>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
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
            <h4 style={{ fontFamily: "'Be Vietnam Pro', sans-serif", fontSize: 18, fontWeight: 600, color: 'var(--adm-primary-dark)', marginBottom: 8 }}>
              Hướng dẫn phê duyệt
            </h4>
            <p style={{ fontSize: 14, color: 'var(--adm-on-surface-variant)', lineHeight: 1.6 }}>
              Kiểm tra giấy phép kinh doanh, mã số thuế và thông tin liên hệ trước khi phê duyệt hồ sơ.
            </p>
          </div>
          <div style={{ position: 'absolute', right: -40, bottom: -40, opacity: 0.08 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 160 }}>verified_user</span>
          </div>
        </div>

        <div className="admin-page-section" style={{ padding: 24 }}>
          <h4 style={{ fontFamily: "'Be Vietnam Pro', sans-serif", fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
            Tóm tắt trạng thái
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {partners.filter((partner) => partner.status !== 'pending').slice(0, 5).map((partner) => (
              <div key={partner.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: partner.status === 'approved' ? 'rgba(16,185,129,0.1)' : 'rgba(186,26,26,0.1)',
                    color: partner.status === 'approved' ? '#10b981' : 'var(--adm-error)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    {partner.status === 'approved' ? 'check' : 'close'}
                  </span>
                </div>
                <div>
                  <p style={{ fontSize: 13, margin: 0, fontWeight: 500 }}>{partner.name}</p>
                  <p style={{ fontSize: 11, color: 'var(--adm-on-surface-variant)', margin: '2px 0 0' }}>
                    {partner.status === 'approved'
                      ? 'Đã phê duyệt'
                      : partner.rejectReason || STATUS_LABEL[partner.status]}
                  </p>
                </div>
              </div>
            ))}
            {!loading && partners.filter((partner) => partner.status !== 'pending').length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--adm-on-surface-variant)' }}>Chưa có hành động nào.</p>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
