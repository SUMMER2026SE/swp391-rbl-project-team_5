import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import AdminLayout from '../../layouts/AdminLayout';
import * as adminApi from '../../services/adminApi.js';
import '../../styles/admin.css';

const STATUS_LABEL = {
  pending: 'Chờ duyệt',
  approved: 'Đã phê duyệt',
  rejected: 'Đã từ chối',
  suspended: 'Đã đình chỉ',
};
const PAGE_SIZE = 10;

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('vi-VN').format(date);
}

function mapPartner(partner) {
  const documentIsValid =
    partner.documentValidationStatus === 'VALID' && Boolean(partner.businessLicenseUrl);
  const consentIsValid =
    partner.kycConsentAccepted === true
    && Boolean(partner.kycConsentVersion)
    && Boolean(partner.kycConsentAcceptedAt);

  return {
    id: partner.id,
    name: partner.businessName,
    representative: partner.representativeName || '',
    email: partner.user?.email || '—',
    phone: partner.representativePhone || 'Chưa cập nhật',
    accountContactName: partner.user?.fullName || '',
    accountPhone: partner.user?.profile?.phoneNumber || '',
    date: formatDate(partner.createdAt),
    registrationDate: formatDate(partner.registrationDate),
    businessAddress: partner.businessAddress || '',
    status: String(partner.status || 'PENDING').toLowerCase(),
    rejectReason: partner.rejectionReason || '',
    businessLicenseUrl: partner.businessLicenseUrl || '',
    taxCode: partner.taxCode || '',
    bankName: partner.bankName || '',
    branchName: partner.branchName || '',
    bankAccountNumber: partner.bankAccountNumber || '',
    bankAccountName: partner.bankAccountName || '',
    swiftCode: partner.swiftCode || '',
    payoutCurrency: partner.payoutCurrency || 'VND',
    website: partner.website || '',
    description: partner.description || '',
    documentValidationStatus: partner.documentValidationStatus || 'MISSING_OR_UNTRUSTED',
    kycConsentAccepted: partner.kycConsentAccepted === true,
    kycConsentVersion: partner.kycConsentVersion || '',
    kycConsentAcceptedAt: partner.kycConsentAcceptedAt || null,
    isApprovable: documentIsValid && consentIsValid,
  };
}

function computeStats(partners) {
  return {
    pending: partners.filter((partner) => partner.status === 'pending').length,
    approved: partners.filter((partner) => partner.status === 'approved').length,
    rejected: partners.filter((partner) => partner.status === 'rejected').length,
    suspended: partners.filter((partner) => partner.status === 'suspended').length,
    total: partners.length,
  };
}

export default function KycApprovalPage() {
  const [partners, setPartners] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState('');
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [statusTarget, setStatusTarget] = useState(null);
  const [statusReason, setStatusReason] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [serverStats, setServerStats] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadPartners() {
      setLoading(true);
      try {
        const result = await adminApi.listPartners({
          status: filterStatus,
          page,
          limit: PAGE_SIZE,
        });
        if (active) {
          const nextPagination = result.pagination || {
            total: (result.data || []).length,
            totalPages: 1,
          };
          if (page > nextPagination.totalPages) {
            setPage(nextPagination.totalPages);
            return;
          }
          setPartners((result.data || []).map(mapPartner));
          setPagination(nextPagination);
          setServerStats(result.stats || null);
        }
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
  }, [filterStatus, page, reloadKey]);

  async function handleApprove(id) {
    setActionId(id);
    try {
      await adminApi.reviewPartner(id, 'APPROVED');
      setReloadKey((value) => value + 1);
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
      setReloadKey((value) => value + 1);
      toast.error(`Đã từ chối hồ sơ của: ${name}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setActionId('');
    }
  }

  function openStatusAction(partner) {
    setStatusTarget(partner);
    setStatusReason('');
  }

  function closeStatusAction() {
    if (actionId) return;
    setStatusTarget(null);
    setStatusReason('');
  }

  async function handleOperationalStatus() {
    if (!statusTarget) return;
    const suspending = statusTarget.status === 'approved';
    const reason = statusReason.trim();
    if (suspending && !reason) {
      toast.error('Vui lòng nhập lý do đình chỉ đối tác.');
      return;
    }

    const nextStatus = suspending ? 'SUSPENDED' : 'APPROVED';
    setActionId(statusTarget.id);
    try {
      await adminApi.changePartnerStatus(statusTarget.id, nextStatus, reason);
      setReloadKey((value) => value + 1);
      toast.success(suspending
        ? `Đã đình chỉ đối tác: ${statusTarget.name}`
        : `Đã khôi phục đối tác: ${statusTarget.name}`);
      setStatusTarget(null);
      setStatusReason('');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setActionId('');
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const fallbackStats = computeStats(partners);
  const byStatus = serverStats?.byStatus || {};
  const stats = serverStats
    ? {
        pending: Number(byStatus.PENDING || 0),
        approved: Number(byStatus.APPROVED || 0),
        rejected: Number(byStatus.REJECTED || 0),
        suspended: Number(byStatus.SUSPENDED || 0),
        total: Number(serverStats.total || 0),
      }
    : fallbackStats;

  const displayed = partners;

  const STAT_CARDS = [
    { id: 'pending',  icon: 'pending_actions', variant: 'pending',  label: 'Đang chờ duyệt', value: stats.pending },
    { id: 'approved', icon: 'check_circle',    variant: 'approved', label: 'Đã phê duyệt',   value: stats.approved },
    { id: 'rejected', icon: 'cancel',          variant: 'rejected', label: 'Bị từ chối',      value: stats.rejected },
    { id: 'suspended', icon: 'block',           variant: 'rejected', label: 'Bị đình chỉ',     value: stats.suspended },
    { id: 'total',    icon: 'group',           variant: 'total',    label: 'Tổng đối tác',    value: stats.total },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm hồ sơ...">
      {/* Page Header */}
      <div className="admin-page-header">
        <div>
          <h2 style={{ color: 'var(--adm-primary-dark)' }}>Hồ sơ và trạng thái đối tác</h2>
          <p>Xét duyệt KYC và quản lý trạng thái vận hành của từng đối tác.</p>
        </div>

        {/* Filter by status */}
        <div style={{ display: 'flex', gap: 8 }}>
          {['all', 'pending', 'approved', 'rejected', 'suspended'].map(s => (
            <button
              key={s}
              onClick={() => {
                setFilterStatus(s);
                setPage(1);
              }}
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
                <th>Lý Do Từ Chối / Đình Chỉ</th>
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
                        <button
                          onClick={() => setSelectedPartner(partner)}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: 'var(--adm-primary-dark)',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            marginTop: 4,
                            display: 'block',
                          }}
                        >
                          Xem chi tiết hồ sơ
                        </button>
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
                    {['rejected', 'suspended'].includes(partner.status) ? partner.rejectReason : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {partner.status === 'pending' ? (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <button
                          className="btn-approve"
                          disabled={actionId === partner.id || !partner.isApprovable}
                          onClick={() => handleApprove(partner.id)}
                          title={
                            partner.isApprovable
                              ? 'Phê duyệt hồ sơ'
                              : 'Hồ sơ thiếu tài liệu hợp lệ hoặc bằng chứng đồng ý KYC'
                          }
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
                    ) : ['approved', 'suspended'].includes(partner.status) ? (
                      <button
                        className={partner.status === 'approved' ? 'btn-warn' : 'btn-approve'}
                        disabled={actionId === partner.id}
                        onClick={() => openStatusAction(partner)}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                          {partner.status === 'approved' ? 'block' : 'restart_alt'}
                        </span>
                        {partner.status === 'approved' ? 'Đình chỉ' : 'Khôi phục'}
                      </button>
                    ) : (
                      <span aria-label="Không có thao tác khả dụng">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="admin-pagination">
          <p className="admin-pagination__info">
            Hiển thị <strong>{displayed.length}</strong> / <strong>{pagination.total}</strong> hồ sơ
          </p>
          <div className="admin-pagination__controls">
            <button
              className="admin-pagination__btn"
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>chevron_left</span>
            </button>
            <button className="admin-pagination__btn active" disabled>
              {page}/{pagination.totalPages}
            </button>
            <button
              className="admin-pagination__btn"
              disabled={page >= pagination.totalPages || loading}
              onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))}
            >
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

      {selectedPartner && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => setSelectedPartner(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              width: '100%',
              maxWidth: 600,
              padding: 32,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, borderBottom: '1px solid #e1e3e4', paddingBottom: 16 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--adm-primary-dark)', margin: 0 }}>
                Chi tiết hồ sơ đối tác
              </h3>
              <button
                onClick={() => setSelectedPartner(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#6f797a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {/* Doanh nghiệp */}
              <div style={{ gridColumn: 'span 2' }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', color: '#6f797a', margin: '0 0 12px' }}>
                  Thông tin doanh nghiệp
                </h4>
              </div>
              <div>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Tên doanh nghiệp / Đối tác</p>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{selectedPartner.name}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Mã số thuế</p>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{selectedPartner.taxCode || '—'}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Người đại diện</p>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{selectedPartner.representative || '—'}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Số điện thoại</p>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{selectedPartner.phone}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Ngày đăng ký kinh doanh</p>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{selectedPartner.registrationDate}</p>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Địa chỉ trụ sở</p>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{selectedPartner.businessAddress || '—'}</p>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Email liên hệ</p>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{selectedPartner.email}</p>
              </div>

              {/* Tài chính */}
              <div style={{ gridColumn: 'span 2', marginTop: 16, paddingTop: 16, borderTop: '1px solid #e1e3e4' }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', color: '#6f797a', margin: '0 0 12px' }}>
                  Tài khoản ngân hàng thụ hưởng
                </h4>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Ngân hàng</p>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{selectedPartner.bankName || '—'}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Chi nhánh</p>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{selectedPartner.branchName || '—'}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Mã SWIFT/BIC</p>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{selectedPartner.swiftCode || '—'}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Số tài khoản</p>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{selectedPartner.bankAccountNumber || '—'}</p>
              </div>
              <div>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Tên chủ tài khoản</p>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{selectedPartner.bankAccountName || '—'}</p>
              </div>

              {/* Pháp lý */}
              <div style={{ gridColumn: 'span 2', marginTop: 16, paddingTop: 16, borderTop: '1px solid #e1e3e4' }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', color: '#6f797a', margin: '0 0 12px' }}>
                  Hồ sơ pháp lý
                </h4>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 8px' }}>Giấy phép đăng ký kinh doanh</p>
                {selectedPartner.businessLicenseUrl ? (
                  <a
                    href={selectedPartner.businessLicenseUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 20px',
                      borderRadius: 8,
                      background: 'rgba(0,96,104,0.1)',
                      color: 'var(--adm-primary-dark)',
                      fontWeight: 600,
                      fontSize: 14,
                      textDecoration: 'none',
                      transition: 'background 150ms',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(0,96,104,0.15)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'rgba(0,96,104,0.1)'}
                  >
                    <span className="material-symbols-outlined">download_for_offline</span>
                    <span>Tải về / Xem giấy phép kinh doanh</span>
                  </a>
                ) : (
                  <span style={{ color: 'var(--adm-error)', fontWeight: 500 }}>Chưa cập nhật giấy phép</span>
                )}
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 8px' }}>Bằng chứng đồng ý KYC</p>
                {selectedPartner.kycConsentAccepted && selectedPartner.kycConsentAcceptedAt ? (
                  <div
                    style={{
                      borderRadius: 8,
                      background: 'rgba(16,185,129,0.08)',
                      color: '#137333',
                      padding: '10px 12px',
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    Đã đồng ý phiên bản {selectedPartner.kycConsentVersion || '—'} lúc{' '}
                    {formatDate(selectedPartner.kycConsentAcceptedAt)}
                  </div>
                ) : (
                  <span style={{ color: 'var(--adm-error)', fontWeight: 600 }}>
                    Thiếu bằng chứng đồng ý KYC
                  </span>
                )}
              </div>
            </div>

            <div style={{ marginTop: 32, display: 'flex', justifyContent: 'flex-end', gap: 12, borderTop: '1px solid #e1e3e4', paddingTop: 16 }}>
              <button
                onClick={() => setSelectedPartner(null)}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: '1px solid #bec8ca',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#3f484a',
                }}
              >
                Đóng
              </button>
              {selectedPartner.status === 'pending' && (
                <>
                  <button
                    onClick={() => {
                      handleReject(selectedPartner.id, selectedPartner.name);
                      setSelectedPartner(null);
                    }}
                    style={{
                      padding: '10px 20px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--adm-error)',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    Từ chối
                  </button>
                  <button
                    onClick={() => {
                      handleApprove(selectedPartner.id);
                      setSelectedPartner(null);
                    }}
                    disabled={!selectedPartner.isApprovable || actionId === selectedPartner.id}
                    title={
                      selectedPartner.isApprovable
                        ? 'Phê duyệt hồ sơ'
                        : 'Hồ sơ thiếu tài liệu hợp lệ hoặc bằng chứng đồng ý KYC'
                    }
                    style={{
                      padding: '10px 20px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--adm-primary-dark)',
                      color: '#fff',
                      cursor: selectedPartner.isApprovable ? 'pointer' : 'not-allowed',
                      opacity: selectedPartner.isApprovable ? 1 : 0.55,
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    Phê duyệt
                  </button>
                </>
              )}
              {['approved', 'suspended'].includes(selectedPartner.status) && (
                <button
                  className={selectedPartner.status === 'approved' ? 'btn-warn' : 'btn-approve'}
                  disabled={actionId === selectedPartner.id}
                  onClick={() => {
                    openStatusAction(selectedPartner);
                    setSelectedPartner(null);
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    {selectedPartner.status === 'approved' ? 'block' : 'restart_alt'}
                  </span>
                  {selectedPartner.status === 'approved' ? 'Đình chỉ đối tác' : 'Khôi phục đối tác'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {statusTarget && (
        <div className="admin-modal-overlay" onClick={closeStatusAction}>
          <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal__icon admin-modal__icon--warn">
              <span className="material-symbols-outlined" style={{ fontSize: 28 }}>
                {statusTarget.status === 'approved' ? 'block' : 'restart_alt'}
              </span>
            </div>
            <h3 className="admin-modal__title">
              {statusTarget.status === 'approved' ? 'Đình chỉ đối tác' : 'Khôi phục đối tác'}
            </h3>
            <p className="admin-modal__body">
              {statusTarget.status === 'approved'
                ? <>Mọi lượt bán mới và quyền quản lý của <strong>{statusTarget.name}</strong> sẽ bị dừng. Vé đã xác nhận vẫn phải được phục vụ.</>
                : <>Quyền quản lý của <strong>{statusTarget.name}</strong> sẽ được khôi phục. Trạng thái mở bán từng địa điểm không bị thay đổi.</>}
            </p>

            {statusTarget.status === 'approved' && (
              <label className="admin-field">
                <span>Lý do đình chỉ</span>
                <textarea
                  value={statusReason}
                  onChange={(event) => setStatusReason(event.target.value)}
                  placeholder="Nhập lý do vi phạm hoặc quyết định vận hành..."
                  maxLength={1000}
                  disabled={Boolean(actionId)}
                />
              </label>
            )}

            <div className="admin-modal__actions">
              <button className="admin-modal__cancel" disabled={Boolean(actionId)} onClick={closeStatusAction}>
                Hủy bỏ
              </button>
              <button
                className="admin-modal__confirm"
                disabled={Boolean(actionId) || (statusTarget.status === 'approved' && !statusReason.trim())}
                onClick={handleOperationalStatus}
              >
                {actionId
                  ? 'Đang xử lý...'
                  : statusTarget.status === 'approved' ? 'Xác nhận đình chỉ' : 'Xác nhận khôi phục'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
