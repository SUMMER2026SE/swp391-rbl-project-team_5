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
    window.alert(
      `${attraction.name}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Vị trí: ${attraction.location}\n` +
      `Đối tác: ${attraction.partner} (${attraction.partnerId})\n` +
      `Danh mục: ${attraction.category}\n` +
      `Giá: ${attraction.price}\n` +
      `Ngày gửi: ${attraction.date}\n` +
      `Trạng thái: ${STATUS_LABEL[attraction.status] || attraction.status.toUpperCase()}\n` +
      (attraction.status === 'rejected'
        ? `Lý do từ chối: ${attraction.rejectReason || 'Không rõ'}\n`
        : '') +
      `\nMô tả:\n${attraction.description}`,
    );
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
    </AdminLayout>
  );
}
