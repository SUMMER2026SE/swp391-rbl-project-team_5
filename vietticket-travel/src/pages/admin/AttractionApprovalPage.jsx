import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import AdminLayout from '../../layouts/AdminLayout';
import * as adminApi from '../../services/adminApi.js';
import '../../styles/admin.css';

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=400&q=80';

const STATUS_LABEL = {
  draft: 'DRAFT',
  pending: 'PENDING',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  suspended: 'SUSPENDED',
};

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN').format(new Date(value));
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 'Chưa có giá';
  return `${new Intl.NumberFormat('vi-VN').format(amount)} ₫`;
}

function mapAttraction(attraction) {
  return {
    id: attraction.id,
    name: attraction.title,
    location: [attraction.address, attraction.city].filter(Boolean).join(', '),
    partner: attraction.partner?.businessName || 'Không rõ đối tác',
    partnerId: attraction.partner?.id || '—',
    category: attraction.category?.name || 'Chưa phân loại',
    date: formatDate(attraction.createdAt),
    description: attraction.description || 'Chưa có mô tả.',
    price: formatCurrency(attraction.minPrice),
    status: String(attraction.status || 'DRAFT').toLowerCase(),
    rejectReason: attraction.rejectionReason || '',
    image: attraction.primaryImage || FALLBACK_IMAGE,
  };
}

const SYSTEM_STATS = [
  { id: 'pending', icon: 'pending_actions', variant: 'pending', label: 'Tổng chờ duyệt', getter: (list) => list.filter((item) => item.status === 'pending').length },
  { id: 'approved', icon: 'check_circle', variant: 'approved', label: 'Đã duyệt', getter: (list) => list.filter((item) => item.status === 'approved').length },
  { id: 'rejected', icon: 'cancel', variant: 'rejected', label: 'Đã từ chối', getter: (list) => list.filter((item) => item.status === 'rejected').length },
  { id: 'time', icon: 'database', variant: 'time', label: 'Tổng địa điểm', getter: (list) => list.length },
];

export default function AttractionApprovalPage() {
  const [attractions, setAttractions] = useState([]);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState('');
  const [selectedAttraction, setSelectedAttraction] = useState(null);

  useEffect(() => {
    let active = true;

    async function loadAttractions() {
      setLoading(true);
      try {
        const result = await adminApi.listAttractions();
        if (active) setAttractions((result.data || []).map(mapAttraction));
      } catch (error) {
        if (active) toast.error(error.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAttractions();
    return () => {
      active = false;
    };
  }, []);

  async function handleApprove(id) {
    const name = attractions.find((item) => item.id === id)?.name;
    setActionId(id);
    try {
      await adminApi.reviewAttraction(id, 'APPROVED');
      setAttractions((current) =>
        current.map((item) =>
          item.id === id ? { ...item, status: 'approved', rejectReason: '' } : item,
        ),
      );
      toast.success(`Đã phê duyệt địa điểm: ${name}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setActionId('');
    }
  }

  async function handleReject(id) {
    const name = attractions.find((item) => item.id === id)?.name;
    const reason = window.prompt(`Lý do từ chối địa điểm "${name}":`, '');
    if (reason === null) return;

    const rejectionReason = reason.trim();
    if (!rejectionReason) {
      toast.error('Vui lòng nhập lý do từ chối.');
      return;
    }

    setActionId(id);
    try {
      await adminApi.reviewAttraction(id, 'REJECTED', rejectionReason);
      setAttractions((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, status: 'rejected', rejectReason: rejectionReason }
            : item,
        ),
      );
      toast.error(`Đã từ chối địa điểm: ${name}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setActionId('');
    }
  }

  function handleViewDetail(attraction) {
    setSelectedAttraction(attraction);
  }

  const displayed = filterStatus === 'all'
    ? attractions
    : attractions.filter((item) => item.status === filterStatus);

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm địa điểm, đối tác...">
      <div className="admin-page-header">
        <div>
          <h2>Phê duyệt địa điểm du lịch</h2>
          <p>Danh sách các địa điểm đang chờ kiểm duyệt trước khi hiển thị công khai.</p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['all', 'pending', 'approved', 'rejected', 'suspended'].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                border: '1px solid',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                transition: 'all 150ms',
                borderColor: filterStatus === status ? 'var(--adm-primary-dark)' : 'rgba(190,200,202,0.5)',
                background: filterStatus === status ? 'var(--adm-primary-dark)' : 'transparent',
                color: filterStatus === status ? '#fff' : 'var(--adm-on-surface-variant)',
              }}
            >
              {status === 'all' ? 'Tất cả' : STATUS_LABEL[status]}
            </button>
          ))}
        </div>
      </div>

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
              {loading && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--adm-on-surface-variant)' }}>
                    <span className="material-symbols-outlined animate-spin" style={{ fontSize: 28 }}>progress_activity</span>
                    <div>Đang tải danh sách địa điểm...</div>
                  </td>
                </tr>
              )}

              {!loading && displayed.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--adm-on-surface-variant)' }}>
                    Không có địa điểm nào.
                  </td>
                </tr>
              )}

              {!loading && displayed.map((attraction) => (
                <tr key={attraction.id}>
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
                          src={attraction.image}
                          alt={attraction.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                      <div>
                        <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>{attraction.name}</p>
                        <p style={{ fontSize: 12, color: 'var(--adm-on-surface-variant)', margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 2 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>location_on</span>
                          {attraction.location}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{attraction.partner}</div>
                    <div style={{ fontSize: 12, color: 'var(--adm-on-surface-variant)' }}>ID: {attraction.partnerId}</div>
                  </td>
                  <td>
                    <span style={{ background: 'rgba(0,96,104,0.1)', color: 'var(--adm-primary-dark)', padding: '4px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 600 }}>
                      {attraction.category}
                    </span>
                  </td>
                  <td>{attraction.date}</td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span className={`badge badge--${attraction.status}`}>
                        <span className="badge__dot" />
                        {STATUS_LABEL[attraction.status] || attraction.status.toUpperCase()}
                      </span>
                      {attraction.status === 'rejected' && attraction.rejectReason && (
                        <span style={{ fontSize: 11, color: 'var(--adm-error)', maxWidth: 180, wordBreak: 'break-word' }}>
                          Lý do: {attraction.rejectReason}
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                      <button
                        onClick={() => handleViewDetail(attraction)}
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
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>info</span>
                        Chi tiết
                      </button>

                      {attraction.status === 'pending' && (
                        <>
                          <button
                            className="btn-approve"
                            disabled={actionId === attraction.id}
                            onClick={() => handleApprove(attraction.id)}
                          >
                            {actionId === attraction.id ? 'Đang xử lý...' : 'Phê duyệt'}
                          </button>
                          <button
                            className="btn-reject"
                            disabled={actionId === attraction.id}
                            onClick={() => handleReject(attraction.id)}
                          >
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

        <div className="admin-pagination">
          <span className="admin-pagination__info">
            Hiển thị <strong>{displayed.length}</strong> / <strong>{attractions.length}</strong> địa điểm
          </span>
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

      <div className="admin-mini-stats-grid" style={{ marginTop: 32, marginBottom: 0 }}>
        {SYSTEM_STATS.map((stat) => (
          <div className="admin-mini-stat" key={stat.id}>
            <div className={`admin-mini-stat__icon admin-mini-stat__icon--${stat.variant}`}>
              <span className="material-symbols-outlined">{stat.icon}</span>
            </div>
            <div>
              <p className="admin-mini-stat__label">{stat.label}</p>
              <p className="admin-mini-stat__value">{stat.getter(attractions)}</p>
            </div>
          </div>
        ))}
      </div>

      {selectedAttraction && (
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
          onClick={() => setSelectedAttraction(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              width: '100%',
              maxWidth: 700,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
              maxHeight: '90vh',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Image */}
            <div style={{ position: 'relative', height: 240, width: '100%', flexShrink: 0 }}>
              <img
                src={selectedAttraction.image}
                alt={selectedAttraction.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)',
                }}
              />
              <button
                onClick={() => setSelectedAttraction(null)}
                style={{
                  position: 'absolute',
                  top: 16,
                  right: 16,
                  background: 'rgba(255,255,255,0.9)',
                  border: 'none',
                  borderRadius: '50%',
                  width: 36,
                  height: 36,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                  color: '#3f484a',
                }}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
              <div style={{ position: 'absolute', bottom: 20, left: 24, right: 24 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <span
                    style={{
                      background: 'rgba(0,96,104,0.95)',
                      color: '#fff',
                      padding: '4px 12px',
                      borderRadius: 9999,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {selectedAttraction.category}
                  </span>
                  <span className={`badge badge--${selectedAttraction.status}`} style={{ border: 'none', background: 'rgba(255,255,255,0.9)' }}>
                    {STATUS_LABEL[selectedAttraction.status] || selectedAttraction.status.toUpperCase()}
                  </span>
                </div>
                <h3 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 }}>
                  {selectedAttraction.name}
                </h3>
              </div>
            </div>

            {/* Content Body */}
            <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
                <div>
                  <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Vị trí địa điểm</p>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--adm-primary-dark)' }}>location_on</span>
                    {selectedAttraction.location}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Đối tác sở hữu</p>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                    {selectedAttraction.partner} (ID: {selectedAttraction.partnerId})
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Giá vé tối thiểu</p>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--adm-primary-dark)' }}>
                    {selectedAttraction.price}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Ngày gửi yêu cầu</p>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                    {selectedAttraction.date}
                  </p>
                </div>
              </div>

              {selectedAttraction.status === 'rejected' && selectedAttraction.rejectReason && (
                <div style={{ background: 'var(--adm-error-container)', color: 'var(--adm-on-error-container)', padding: 16, borderRadius: 12, marginBottom: 24 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', margin: '0 0 4px' }}>Lý do từ chối</p>
                  <p style={{ fontSize: 13, margin: 0 }}>{selectedAttraction.rejectReason}</p>
                </div>
              )}

              <div style={{ borderTop: '1px solid #e1e3e4', paddingTop: 20 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', color: '#6f797a', margin: '0 0 10px' }}>
                  Mô tả địa điểm
                </h4>
                <p style={{ fontSize: 14, color: '#3f484a', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
                  {selectedAttraction.description}
                </p>
              </div>
            </div>

            {/* Footer Actions */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid #e1e3e4', display: 'flex', justifyContent: 'flex-end', gap: 12, background: '#f5f7f8' }}>
              <button
                onClick={() => setSelectedAttraction(null)}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: '1px solid #bec8ca',
                  background: '#fff',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#3f484a',
                }}
              >
                Đóng
              </button>
              {selectedAttraction.status === 'pending' && (
                <>
                  <button
                    onClick={() => {
                      handleReject(selectedAttraction.id);
                      setSelectedAttraction(null);
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
                      handleApprove(selectedAttraction.id);
                      setSelectedAttraction(null);
                    }}
                    style={{
                      padding: '10px 20px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--adm-primary-dark)',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    Phê duyệt
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
