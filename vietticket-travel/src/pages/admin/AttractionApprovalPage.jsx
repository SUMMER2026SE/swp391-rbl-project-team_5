import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import AdminLayout from '../../layouts/AdminLayout';
import * as adminApi from '../../services/adminApi.js';
import { formatAttractionLocation } from '../../utils/location.js';
import '../../styles/admin.css';

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=400&q=80';

const STATUS_LABEL = {
  draft: 'Bản nháp',
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Đã từ chối',
  suspended: 'Đình chỉ',
};
const PAGE_SIZE = 10;

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
    location: formatAttractionLocation(attraction),
    partner: attraction.partner?.businessName || 'Không rõ đối tác',
    partnerId: attraction.partner?.id || '—',
    category: attraction.category?.name || 'Chưa phân loại',
    date: formatDate(attraction.submittedAt || attraction.createdAt),
    submittedAt: attraction.submittedAt,
    reviewedAt: attraction.reviewedAt,
    reviewedByName: attraction.reviewedByName,
    revision: attraction.revision || 0,
    publicationStatus: attraction.publicationStatus,
    description: attraction.description || 'Chưa có mô tả.',
    price: formatCurrency(attraction.minPrice),
    status: String(attraction.status || 'DRAFT').toLowerCase(),
    rejectReason: attraction.rejectionReason || '',
    image: attraction.primaryImage || FALLBACK_IMAGE,
    images: attraction.images || [],
    tickets: attraction.ticketProducts || [],
    schedule: attraction.schedule || {},
    openTime: attraction.openTime,
    closeTime: attraction.closeTime,
    latitude: attraction.latitude,
    longitude: attraction.longitude,
    reviewHistory: attraction.reviewHistory || [],
  };
}

const SYSTEM_STATS = [
  { id: 'pending', icon: 'pending_actions', variant: 'pending', label: 'Tổng chờ duyệt', status: 'PENDING' },
  { id: 'approved', icon: 'check_circle', variant: 'approved', label: 'Đã duyệt', status: 'APPROVED' },
  { id: 'rejected', icon: 'cancel', variant: 'rejected', label: 'Đã từ chối', status: 'REJECTED' },
  { id: 'time', icon: 'database', variant: 'time', label: 'Tổng địa điểm', status: 'TOTAL' },
];

export default function AttractionApprovalPage() {
  const [attractions, setAttractions] = useState([]);
  const [filterStatus, setFilterStatus] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState('');
  const [selectedAttraction, setSelectedAttraction] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [serverStats, setServerStats] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadAttractions() {
      setLoading(true);
      try {
        const result = await adminApi.listAttractions({
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
          setAttractions((result.data || []).map(mapAttraction));
          setPagination(nextPagination);
          setServerStats(result.stats || null);
        }
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
  }, [filterStatus, page, reloadKey]);

  async function handleApprove(id) {
    const name = attractions.find((item) => item.id === id)?.name;
    setActionId(id);
    try {
      await adminApi.reviewAttraction(id, 'APPROVED');
      setReloadKey((value) => value + 1);
      toast.success(`Đã phê duyệt địa điểm: ${name}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setActionId('');
    }
  }

  function handleReject(id) {
    setRejectTarget(attractions.find((item) => item.id === id) || null);
    setRejectionReason('');
  }

  async function submitRejection() {
    const reason = rejectionReason.trim();
    if (!reason) {
      toast.error('Vui lòng nhập lý do từ chối.');
      return;
    }

    const target = rejectTarget;
    setActionId(target.id);
    try {
      await adminApi.reviewAttraction(target.id, 'REJECTED', reason);
      setReloadKey((value) => value + 1);
      toast.info(`Đã từ chối địa điểm: ${target.name}`);
      setRejectTarget(null);
      setSelectedAttraction(null);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setActionId('');
    }
  }

  function handleViewDetail(attraction) {
    setSelectedAttraction(attraction);
  }

  const displayed = attractions;

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
              onClick={() => {
                setFilterStatus(status);
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
            Hiển thị <strong>{displayed.length}</strong> / <strong>{pagination.total}</strong> địa điểm
          </span>
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

      <div className="admin-mini-stats-grid" style={{ marginTop: 32, marginBottom: 0 }}>
        {SYSTEM_STATS.map((stat) => (
          <div className="admin-mini-stat" key={stat.id}>
            <div className={`admin-mini-stat__icon admin-mini-stat__icon--${stat.variant}`}>
              <span className="material-symbols-outlined">{stat.icon}</span>
            </div>
            <div>
              <p className="admin-mini-stat__label">{stat.label}</p>
              <p className="admin-mini-stat__value">
                {stat.status === 'TOTAL'
                  ? Number(serverStats?.total || 0)
                  : Number(serverStats?.byStatus?.[stat.status] || 0)}
              </p>
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
                    {selectedAttraction.partner}
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
                <div>
                  <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Giờ hoạt động</p>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                    {selectedAttraction.openTime || '—'} - {selectedAttraction.closeTime || '—'}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: 12, color: '#6f797a', margin: '0 0 4px' }}>Tọa độ / phiên bản</p>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                    {selectedAttraction.latitude ?? '—'}, {selectedAttraction.longitude ?? '—'} · v{selectedAttraction.revision}
                  </p>
                </div>
              </div>

              {selectedAttraction.images.length > 1 && (
                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, color: '#6f797a', margin: '0 0 10px' }}>THƯ VIỆN ẢNH</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {selectedAttraction.images.map((image) => (
                      <img key={image.id} src={image.url} alt="" style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 8 }} />
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 24 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: '#6f797a', margin: '0 0 10px' }}>VÉ VÀ SỨC CHỨA</h4>
                <p style={{ fontSize: 13, margin: '0 0 8px' }}>
                  Sức chứa mặc định: <strong>{selectedAttraction.schedule.defaultCapacity ?? '—'}</strong>
                </p>
                {selectedAttraction.tickets.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#ba1a1a', margin: 0 }}>Chưa cấu hình gói vé hoạt động.</p>
                ) : selectedAttraction.tickets.map((ticket) => (
                  <div key={ticket.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid #eef0f1', fontSize: 13 }}>
                    <span>{ticket.name} ({ticket.type})</span>
                    <strong>{formatCurrency(ticket.sellingPrice)}</strong>
                  </div>
                ))}
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

              {selectedAttraction.reviewHistory.length > 0 && (
                <div style={{ borderTop: '1px solid #e1e3e4', paddingTop: 20, marginTop: 20 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, color: '#6f797a', margin: '0 0 10px' }}>LỊCH SỬ KIỂM DUYỆT</h4>
                  {selectedAttraction.reviewHistory.slice(0, 5).map((entry) => (
                    <p key={entry.id} style={{ fontSize: 12, margin: '6px 0', color: '#3f484a' }}>
                      {formatDate(entry.createdAt)} · {entry.action}
                    </p>
                  ))}
                </div>
              )}
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
                    onClick={() => handleReject(selectedAttraction.id)}
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

      {rejectTarget && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setRejectTarget(null)}
        >
          <div
            style={{ background: '#fff', width: '100%', maxWidth: 520, borderRadius: 16, padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 20 }}>Từ chối phiên bản địa điểm</h3>
            <p style={{ margin: '0 0 16px', color: '#5f6b6d', fontSize: 14 }}>
              Ghi rõ nội dung cần sửa cho "{rejectTarget.name}". Lý do này sẽ được lưu vào lịch sử và gửi email cho partner.
            </p>
            <textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              rows={5}
              maxLength={1000}
              placeholder="Ví dụ: Mô tả chưa đủ rõ, ảnh đại diện không đúng địa điểm..."
              style={{ width: '100%', resize: 'vertical', border: '1px solid #bec8ca', borderRadius: 10, padding: 12, font: 'inherit', boxSizing: 'border-box' }}
            />
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="admin-pagination__btn" onClick={() => setRejectTarget(null)}>Hủy</button>
              <button
                className="btn-reject"
                disabled={actionId === rejectTarget.id || !rejectionReason.trim()}
                onClick={submitRejection}
              >
                {actionId === rejectTarget.id ? 'Đang xử lý...' : 'Xác nhận từ chối'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
