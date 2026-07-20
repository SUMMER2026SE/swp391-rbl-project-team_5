import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import AdminLayout from '../../layouts/AdminLayout';
import * as adminApi from '../../services/adminApi.js';
import { formatAttractionLocation } from '../../utils/location.js';
import '../../styles/admin.css';

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1528127269322-539801943592?auto=format&fit=crop&w=400&q=80';

const ALL_STATUSES = ['all', 'active', 'paused', 'hidden'];
const PAGE_SIZE = 10;
const STATUS_LABEL = {
  all: 'Tất cả',
  active: 'Đang hoạt động',
  paused: 'Đang tạm dừng',
  hidden: 'Bị đình chỉ',
};

function formatReviews(value) {
  const count = Number(value) || 0;
  return new Intl.NumberFormat('vi-VN', { notation: 'compact' }).format(count);
}

function mapLocation(attraction) {
  return {
    id: attraction.id,
    name: attraction.title,
    location: formatAttractionLocation(attraction),
    partner: attraction.partner?.businessName || 'Không rõ đối tác',
    category: attraction.category?.name || 'Chưa phân loại',
    rating: Number(attraction.averageRating || 0),
    reviews: formatReviews(attraction.totalReviews),
    status: attraction.operationalStatus === 'SUSPENDED'
      ? 'hidden'
      : attraction.publicationStatus === 'ACTIVE' ? 'active' : 'paused',
    image: attraction.primaryImage || FALLBACK_IMAGE,
  };
}

function ConfirmModal({
  target,
  reason,
  loading,
  onClose,
  onConfirm,
  onReasonChange,
}) {
  if (!target) return null;
  const hiding = target.status !== 'hidden';

  return (
    <div className="admin-modal-overlay" onClick={loading ? undefined : onClose}>
      <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
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
            ? 'Địa điểm sẽ không còn xuất hiện trên nền tảng người dùng.'
            : 'Địa điểm sẽ về trạng thái tạm dừng; đối tác phải kiểm tra và chủ động mở bán lại.'}
        </p>

        {hiding && (
          <label className="admin-field">
            <span>Lý do tạm ẩn</span>
            <textarea
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder="Nhập nội dung vi phạm hoặc lý do tạm ẩn..."
              disabled={loading}
            />
          </label>
        )}

        <div className="admin-modal__actions">
          <button className="admin-modal__cancel" disabled={loading} onClick={onClose}>
            Hủy bỏ
          </button>
          <button
            className="admin-modal__confirm"
            disabled={loading || (hiding && !reason.trim())}
            onClick={onConfirm}
          >
            {loading ? 'Đang xử lý...' : hiding ? 'Xác nhận ẩn' : 'Khôi phục'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ViolationManagementPage() {
  const [locations, setLocations] = useState([]);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [serverStats, setServerStats] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadLocations() {
      setLoading(true);
      try {
        const params = { page, limit: PAGE_SIZE };
        if (filterStatus === 'hidden') {
          params.operationalStatus = 'SUSPENDED';
        } else if (filterStatus === 'active' || filterStatus === 'paused') {
          params.published = true;
          params.operationalStatus = 'ACTIVE';
          params.publicationStatus = filterStatus === 'active' ? 'ACTIVE' : 'PAUSED';
        } else {
          params.published = true;
        }
        const result = await adminApi.listAttractions(params);
        if (active) {
          const nextPagination = result.pagination || {
            total: (result.data || []).length,
            totalPages: 1,
          };
          if (page > nextPagination.totalPages) {
            setPage(nextPagination.totalPages);
            return;
          }
          setLocations((result.data || []).map(mapLocation));
          setPagination(nextPagination);
          setServerStats(result.stats || null);
        }
      } catch (error) {
        if (active) toast.error(error.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadLocations();
    return () => {
      active = false;
    };
  }, [filterStatus, page, reloadKey]);

  function handleToggle(location) {
    setConfirmTarget(location);
    setReason('');
  }

  function closeConfirm() {
    if (actionId) return;
    setConfirmTarget(null);
    setReason('');
  }

  async function confirmToggle() {
    if (!confirmTarget) return;

    const hiding = confirmTarget.status !== 'hidden';
    const trimmedReason = reason.trim();
    if (hiding && !trimmedReason) {
      toast.error('Vui lòng nhập lý do tạm ẩn.');
      return;
    }

    setActionId(confirmTarget.id);
    try {
      if (hiding) {
        await adminApi.hideAttraction(confirmTarget.id, trimmedReason);
      } else {
        await adminApi.restoreAttraction(confirmTarget.id);
      }

      setReloadKey((value) => value + 1);
      toast.success(
        hiding
          ? `Đã tạm ẩn địa điểm: ${confirmTarget.name}`
          : `Đã khôi phục và giữ tạm dừng địa điểm: ${confirmTarget.name}`,
      );
      setConfirmTarget(null);
      setReason('');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setActionId('');
    }
  }

  const displayed = locations;
  const activeCount = Number(serverStats?.operational?.active || 0);

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm địa điểm, đối tác...">
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

      <div className="admin-filter-bar">
        <div className="admin-filter-group" style={{ minWidth: 160 }}>
          <label htmlFor="vioStatus">Trạng thái</label>
          <select
            id="vioStatus"
            value={filterStatus}
            onChange={(event) => {
              setFilterStatus(event.target.value);
              setPage(1);
            }}
          >
            {ALL_STATUSES.map((status) => (
              <option key={status} value={status}>{STATUS_LABEL[status]}</option>
            ))}
          </select>
        </div>

        <button
          onClick={() => {
            setFilterStatus('all');
            setPage(1);
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
                    Không tìm thấy địa điểm nào.
                  </td>
                </tr>
              )}

              {!loading && displayed.map((location) => (
                <tr
                  key={location.id}
                  style={{ opacity: location.status === 'hidden' ? 0.65 : 1, transition: 'opacity 200ms' }}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <img
                        src={location.image}
                        alt={location.name}
                        style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }}
                      />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{location.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--adm-on-surface-variant)', display: 'flex', alignItems: 'center', gap: 2, marginTop: 2 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>location_on</span>
                          {location.location}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ color: 'rgba(26,28,30,0.8)' }}>{location.partner}</td>
                  <td>
                    <span style={{ padding: '4px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 600, background: 'rgba(254,222,168,0.5)', color: 'var(--adm-secondary)' }}>
                      {location.category}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--adm-secondary)', fontVariationSettings: "'FILL' 1" }}>
                        star
                      </span>
                      <span style={{ fontWeight: 700, color: 'var(--adm-primary-dark)' }}>{location.rating.toFixed(1)}</span>
                      <span style={{ fontSize: 12, color: 'var(--adm-on-surface-variant)' }}>({location.reviews})</span>
                    </div>
                  </td>
                  <td>
                    {location.status === 'active' ? (
                      <span className="badge badge--active">
                        <span className="badge__dot" style={{ background: 'var(--adm-primary-dark)' }} />
                        Hoạt động
                      </span>
                    ) : location.status === 'paused' ? (
                      <span className="badge badge--pending">
                        <span className="badge__dot" />
                        Tạm dừng
                      </span>
                    ) : (
                      <span className="badge badge--hidden">
                        <span className="badge__dot" style={{ background: 'var(--adm-outline)' }} />
                        Đã ẩn
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {location.status !== 'hidden' ? (
                      <button
                        className="btn-warn"
                        disabled={actionId === location.id}
                        onClick={() => handleToggle(location)}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>visibility_off</span>
                        Tạm ẩn
                      </button>
                    ) : (
                      <button
                        disabled={actionId === location.id}
                        onClick={() => handleToggle(location)}
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

        <div className="admin-pagination">
          <p className="admin-pagination__info">
            Hiển thị <strong>{displayed.length}</strong> / <strong>{pagination.total}</strong> địa điểm
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

      <ConfirmModal
        target={confirmTarget}
        reason={reason}
        loading={Boolean(actionId)}
        onClose={closeConfirm}
        onConfirm={confirmToggle}
        onReasonChange={setReason}
      />
    </AdminLayout>
  );
}
