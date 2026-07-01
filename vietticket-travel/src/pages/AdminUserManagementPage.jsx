import '../styles/admin.css'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import { useAuth } from '../context/useAuth.js'
import { getUsers, changeUserStatus } from '../services/adminApi.js'
import AdminSidebar from '../components/admin/AdminSidebar.jsx'

const roleOptions = ['CUSTOMER', 'PARTNER', 'ADMIN', 'STAFF']
const statusOptions = ['ACTIVE', 'LOCKED']

function AdminUserManagementPage() {
  const { user } = useAuth()

  const [users, setUsers] = useState([])
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [statsData, setStatsData] = useState({
    totalAccounts: 0,
    activeCustomers: 0,
    attractionPartners: 0,
    lockedAccounts: 0,
  })

  const [isLoading, setIsLoading] = useState(false)
  const [refetchIndex, setRefetchIndex] = useState(0)

  const [activeModal, setActiveModal] = useState(null)
  const [targetUserId, setTargetUserId] = useState(null)
  const [lockReason, setLockReason] = useState('')
  const [lockSendEmail, setLockSendEmail] = useState(true)
  const [unlockSendEmail, setUnlockSendEmail] = useState(true)
  const [statusActionUserId, setStatusActionUserId] = useState(null)

  useEffect(() => {
    document.title = 'Quản lý Người dùng | VietTicket Travel'
  }, [])

  useEffect(() => {
    let isMounted = true

    const delayDebounceFn = setTimeout(async () => {
      setIsLoading(true)
      try {
        const data = await getUsers({
          page,
          limit: 10,
          search: searchTerm,
          role: roleFilter,
          status: statusFilter,
        })
        if (isMounted) {
          setUsers(data.users || [])
          setTotal(data.pagination?.total || 0)
          setStatsData(data.stats || null)
        }
      } catch (error) {
        toast.error(error.message || 'Không thể tải danh sách người dùng.')
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }, 300)

    return () => {
      isMounted = false
      clearTimeout(delayDebounceFn)
    }
  }, [searchTerm, roleFilter, statusFilter, page, refetchIndex])

  const targetUser = useMemo(
    () => users.find((user) => user.id === targetUserId),
    [targetUserId, users],
  )

  const stats = useMemo(
    () => [
      {
        id: 'total',
        label: 'Tổng tài khoản',
        value: statsData.totalAccounts.toLocaleString('vi-VN'),
        icon: 'group',
        tone: 'primary',
      },
      {
        id: 'customers',
        label: 'Khách hàng hoạt động',
        value: statsData.activeCustomers.toLocaleString('vi-VN'),
        icon: 'person',
        tone: 'primary',
      },
      {
        id: 'partners',
        label: 'Đối tác địa điểm',
        value: statsData.attractionPartners.toLocaleString('vi-VN'),
        icon: 'store',
        tone: 'primary',
      },
      {
        id: 'locked',
        label: 'Tài khoản bị khóa',
        value: statsData.lockedAccounts.toLocaleString('vi-VN'),
        icon: 'lock',
        tone: 'danger',
      },
    ],
    [statsData],
  )

  const handleResetFilters = () => {
    setSearchTerm('')
    setRoleFilter('')
    setStatusFilter('')
    setPage(1)
  }

  const openLockModal = (userId) => {
    if (statusActionUserId) return
    setTargetUserId(userId)
    setLockReason('')
    setLockSendEmail(true)
    setActiveModal('lock')
  }

  const openUnlockModal = (userId) => {
    if (statusActionUserId) return
    setTargetUserId(userId)
    setUnlockSendEmail(true)
    setActiveModal('unlock')
  }

  const closeModals = () => {
    setActiveModal(null)
    setTargetUserId(null)
    setLockReason('')
    setLockSendEmail(true)
    setUnlockSendEmail(true)
  }

  const applyUserStatusResult = (updatedUser) => {
    if (!updatedUser) return
    setUsers((current) => current.map((item) => (item.id === updatedUser.id ? updatedUser : item)))
  }

  async function handleLockAccount(userId, reason, sendEmail) {
    setStatusActionUserId(userId)
    try {
      const data = await changeUserStatus(userId, { status: 'LOCKED', reason, sendEmail })
      toast.success(data.message || 'Đã khóa tài khoản thành công')
      applyUserStatusResult(data.user)
      setRefetchIndex((prev) => prev + 1)
      closeModals()
    } catch (error) {
      toast.error(error.message || 'Không thể khóa tài khoản.')
    } finally {
      setStatusActionUserId(null)
    }
  }

  async function handleUnlockAccount(userId, sendEmail) {
    setStatusActionUserId(userId)
    try {
      const data = await changeUserStatus(userId, { status: 'ACTIVE', sendEmail })
      applyUserStatusResult(data.user)
      toast.success(data.message || 'Đã mở khóa tài khoản thành công')
      setRefetchIndex((prev) => prev + 1)
      closeModals()
    } catch (error) {
      toast.error(error.message || 'Không thể mở khóa tài khoản.')
    } finally {
      setStatusActionUserId(null)
    }
  }

  const handleLockSubmit = async (event) => {
    event.preventDefault()
    if (targetUserId === null || isStatusActionPending) return
    await handleLockAccount(targetUserId, lockReason, lockSendEmail)
  }

  const handleUnlockSubmit = async (event) => {
    event.preventDefault()
    if (targetUserId === null || isStatusActionPending) return
    await handleUnlockAccount(targetUserId, unlockSendEmail)
  }

  const totalPages = Math.ceil(total / 10)
  const visibleStart = total > 0 ? (page - 1) * 10 + 1 : 0
  const visibleEnd = Math.min(page * 10, total)
  const isStatusActionPending = Boolean(statusActionUserId)

  return (
    <div className="admin-page">
      <AdminSidebar />

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-search admin-search--topbar">
            <span className="material-symbols-outlined" aria-hidden="true">
              search
            </span>
            <input
              id="quick-search-input"
              type="search"
              value={searchTerm}
              placeholder="Tìm kiếm nhanh..."
              aria-label="Tìm kiếm nhanh người dùng"
              onChange={(event) => {
                setSearchTerm(event.target.value)
                setPage(1)
              }}
            />
          </div>

          <div className="admin-topbar__actions">
            <button
              className="admin-icon-button admin-notification-button"
              id="btn-admin-notifications"
              type="button"
              aria-label="Mở thông báo"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                notifications
              </span>
              <span className="admin-notification-dot" aria-hidden="true" />
            </button>
            <button
              className="admin-icon-button"
              id="btn-admin-help"
              type="button"
              aria-label="Mở trợ giúp"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                help_outline
              </span>
            </button>
            <div className="admin-profile-chip">
              <div className="admin-profile-chip__text">
                <p>{user?.fullName || 'Admin'}</p>
                <span>{user?.role === 'ADMIN' ? 'Quản trị viên' : user?.role || 'Admin'}</span>
              </div>
              <img
                src={user?.avatar || 'https://ui-avatars.com/api/?name=Admin&background=006068&color=fff'}
                alt={user?.fullName || 'Admin'}
              />
            </div>
          </div>
        </header>

        <div className="admin-content">
          <section className="admin-page-heading" aria-labelledby="admin-user-title">
            <h2 id="admin-user-title">Quản lý Tài khoản</h2>
            <p>Xem danh sách, kiểm soát trạng thái hoạt động của thành viên và đối tác.</p>
          </section>

          <section className="admin-stats-grid" aria-label="Thống kê tài khoản">
            {stats.map((stat) => (
              <article className="admin-stat-card" key={stat.id}>
                <span
                  className={`admin-stat-card__icon admin-stat-card__icon--${stat.tone}`}
                  aria-hidden="true"
                >
                  <span className="material-symbols-outlined">{stat.icon}</span>
                </span>
                <p>{stat.label}</p>
                <strong
                  className={`admin-stat-card__value${
                    stat.tone === 'danger' ? ' admin-stat-card__value--danger' : ''
                  }`}
                >
                  {stat.value}
                </strong>
              </article>
            ))}
          </section>

          <section className="admin-filter-panel" aria-label="Bộ lọc người dùng">
            <div className="admin-search admin-search--filter">
              <span className="material-symbols-outlined" aria-hidden="true">
                search
              </span>
              <input
                id="search-input"
                type="search"
                value={searchTerm}
                placeholder="Tìm kiếm theo tên hoặc email..."
                aria-label="Tìm kiếm theo tên hoặc email"
                onChange={(event) => {
                  setSearchTerm(event.target.value)
                  setPage(1)
                }}
              />
            </div>

            <div className="admin-filter-panel__controls">
              <label className="admin-select-field" htmlFor="role-filter">
                <span className="admin-select-field__label">Vai trò</span>
                <select
                  id="role-filter"
                  value={roleFilter}
                  onChange={(event) => {
                    setRoleFilter(event.target.value)
                    setPage(1)
                  }}
                >
                  <option value="">Tất cả vai trò</option>
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined" aria-hidden="true">
                  expand_more
                </span>
              </label>

              <label className="admin-select-field" htmlFor="status-filter">
                <span className="admin-select-field__label">Trạng thái</span>
                <select
                  id="status-filter"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value)
                    setPage(1)
                  }}
                >
                  <option value="">Tất cả trạng thái</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined" aria-hidden="true">
                  expand_more
                </span>
              </label>

              <button
                className="admin-reset-button"
                id="btn-reset-filters"
                type="button"
                onClick={handleResetFilters}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  restart_alt
                </span>
                Đặt lại
              </button>
            </div>
          </section>

          <section className="admin-table-card" aria-labelledby="admin-user-table-title">
            <div className="admin-table-card__header">
              <h3 id="admin-user-table-title">Danh sách người dùng</h3>
              <span>{total.toLocaleString('vi-VN')} kết quả</span>
            </div>

            <div className="admin-table-scroll">
              <table className="admin-user-table">
                <thead>
                  <tr>
                    <th scope="col">Người dùng</th>
                    <th scope="col">Vai trò</th>
                    <th scope="col" className="admin-table-cell--center">
                      Google
                    </th>
                    <th scope="col">Trạng thái</th>
                    <th scope="col">Ngày đăng ký</th>
                    <th scope="col" className="admin-table-cell--right">
                      Hành động
                    </th>
                  </tr>
                </thead>
                <tbody id="user-table-body">
                  {isLoading ? (
                    <tr>
                      <td className="admin-empty-state" colSpan="6">
                        Đang tải danh sách...
                      </td>
                    </tr>
                  ) : users.length ? (
                    users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <div className="admin-user-cell">
                            <img src={user.avatar} alt={user.fullName} />
                            <div>
                              <p>{user.fullName}</p>
                              <span>{user.email}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`admin-role-badge admin-role-badge--${user.role.toLowerCase()}`}
                          >
                            {user.role === 'ADMIN'
                              ? 'Quản trị viên'
                              : user.role === 'CUSTOMER'
                              ? 'Khách hàng'
                              : user.role === 'PARTNER'
                              ? 'Đối tác'
                              : user.role === 'STAFF'
                              ? 'Nhân viên'
                              : user.role}
                          </span>
                        </td>
                        <td className="admin-table-cell--center">
                          {user.provider === 'GOOGLE' ? (
                            <span
                              className="material-symbols-outlined admin-google-status admin-google-status--active"
                              aria-label="Đã kết nối Google"
                            >
                              check_circle
                            </span>
                          ) : (
                            <span
                              className="material-symbols-outlined admin-google-status"
                              aria-label="Chưa kết nối Google"
                            >
                              cancel
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="admin-status-cell">
                            <span
                              className={`admin-status-dot admin-status-dot--${user.status.toLowerCase()}`}
                              aria-hidden="true"
                            />
                            <span
                              className={`admin-status-text admin-status-text--${user.status.toLowerCase()}`}
                            >
                              {user.status === 'ACTIVE' ? 'Hoạt động' : 'Đang khóa'}
                            </span>
                          </div>
                        </td>
                        <td className="admin-date-cell">
                          {user.createdAt
                            ? new Date(user.createdAt).toLocaleDateString('vi-VN', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                              })
                            : ''}
                        </td>
                        <td className="admin-table-cell--right">
                          <div className="admin-row-actions">
                            {user.status === 'ACTIVE' ? (
                              <button
                                className="admin-row-action admin-row-action--danger"
                                id={`btn-lock-user-${user.id}`}
                                disabled={isStatusActionPending}
                                type="button"
                                title="Khóa tài khoản"
                                aria-label={`Khóa tài khoản ${user.fullName || user.name}`}
                                onClick={() => openLockModal(user.id)}
                              >
                                <span className="material-symbols-outlined" aria-hidden="true">
                                  lock
                                </span>
                              </button>
                            ) : (
                              <button
                                className="admin-row-action admin-row-action--primary"
                                id={`btn-unlock-user-${user.id}`}
                                disabled={isStatusActionPending}
                                type="button"
                                title="Mở khóa tài khoản"
                                aria-label={`Mở khóa tài khoản ${user.fullName || user.name}`}
                                onClick={() => openUnlockModal(user.id)}
                              >
                                <span className="material-symbols-outlined" aria-hidden="true">
                                  lock_open
                                </span>
                              </button>
                            )}
                            <button
                              className="admin-row-action admin-row-action--secondary"
                              id={`btn-edit-user-${user.id}`}
                              type="button"
                              title="Tính năng đang phát triển"
                              aria-label={`Chỉnh sửa tài khoản ${user.fullName}`}
                              disabled
                            >
                              <span className="material-symbols-outlined" aria-hidden="true">
                                  edit
                              </span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="admin-empty-state" colSpan="6">
                        Không tìm thấy tài khoản phù hợp.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {total > 0 && (
              <div className="admin-pagination">
                <p>
                  Hiển thị {visibleStart} - {visibleEnd} trong tổng số{' '}
                  {total.toLocaleString('vi-VN')} tài khoản
                </p>
                {totalPages > 1 && (
                  <div className="admin-pagination__controls" aria-label="Phân trang">
                    <button
                      className="admin-pagination-button"
                      id="btn-pagination-prev"
                      type="button"
                      disabled={page === 1}
                      aria-label="Trang trước"
                      onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        chevron_left
                      </span>
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                      .map((p, index, arr) => {
                        const showEllipsis = index > 0 && p - arr[index - 1] > 1
                        return (
                          <div key={p} style={{ display: 'inline-flex', alignItems: 'center' }}>
                            {showEllipsis && (
                              <span aria-hidden="true" style={{ paddingInline: '4px' }}>
                                ...
                              </span>
                            )}
                            <button
                              className={`admin-pagination-button${
                                p === page ? ' admin-pagination-button--active' : ''
                              }`}
                              id={`btn-pagination-page-${p}`}
                              type="button"
                              onClick={() => setPage(p)}
                            >
                              {p}
                            </button>
                          </div>
                        )
                      })}
                    <button
                      className="admin-pagination-button"
                      id="btn-pagination-next"
                      type="button"
                      disabled={page === totalPages}
                      aria-label="Trang tiếp theo"
                      onClick={() => setPage((prev) => Math.min(prev + 1, totalPages))}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        chevron_right
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </main>

      {activeModal ? (
        <div className="admin-modal-container" id="modal-container">
          <button
            className="admin-modal-backdrop"
            id="btn-close-modal-backdrop"
            type="button"
            disabled={isStatusActionPending}
            aria-label="Đóng hộp thoại"
            onClick={closeModals}
          />

          {activeModal === 'lock' ? (
            <form
              className="admin-modal"
              id="lock-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lock-modal-title"
              onSubmit={handleLockSubmit}
            >
              <div className="admin-modal__header">
                <span className="admin-modal__icon admin-modal__icon--danger" aria-hidden="true">
                  <span className="material-symbols-outlined">lock_person</span>
                </span>
                <div>
                  <h3 id="lock-modal-title">Khóa tài khoản</h3>
                  <p>Hành động này sẽ ngăn {targetUser?.fullName || 'người dùng'} truy cập.</p>
                </div>
              </div>

              <label className="admin-field" htmlFor="lock-reason-input">
                <span>Lý do khóa tài khoản</span>
                <textarea
                  id="lock-reason-input"
                  disabled={isStatusActionPending}
                  value={lockReason}
                  placeholder="Nhập lý do chi tiết..."
                  onChange={(event) => setLockReason(event.target.value)}
                />
              </label>

              <label className="admin-checkbox" htmlFor="lock-send-email-checkbox">
                <input
                  id="lock-send-email-checkbox"
                  type="checkbox"
                  disabled={isStatusActionPending}
                  checked={lockSendEmail}
                  onChange={(event) => setLockSendEmail(event.target.checked)}
                />
                <span className="admin-checkbox__box" aria-hidden="true">
                  <span className="material-symbols-outlined">check</span>
                </span>
                <span>Gửi email thông báo cho người dùng</span>
              </label>

              <div className="admin-modal__actions">
                <button
                  className="admin-modal-button admin-modal-button--secondary"
                  id="btn-cancel-lock"
                  type="button"
                  disabled={isStatusActionPending}
                  onClick={closeModals}
                >
                  Hủy
                </button>
                <button
                  className="admin-modal-button admin-modal-button--danger"
                  id="btn-submit-lock"
                  type="submit"
                  disabled={isStatusActionPending}
                >
                  {isStatusActionPending ? 'Đang khóa...' : 'Xác nhận Khóa'}
                </button>
              </div>
            </form>
          ) : (
            <form
              className="admin-modal"
              id="unlock-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="unlock-modal-title"
              onSubmit={handleUnlockSubmit}
            >
              <div className="admin-modal__header">
                <span className="admin-modal__icon admin-modal__icon--primary" aria-hidden="true">
                  <span className="material-symbols-outlined">lock_open</span>
                </span>
                <div>
                  <h3 id="unlock-modal-title">Mở khóa tài khoản</h3>
                  <p>Khôi phục quyền truy cập cho {targetUser?.fullName || 'người dùng'}.</p>
                </div>
              </div>

              <p className="admin-modal__body-text">
                Bạn có chắc chắn muốn mở khóa cho tài khoản này? Người dùng sẽ có thể đăng nhập lại ngay lập tức.
              </p>

              <label className="admin-checkbox" htmlFor="unlock-send-email-checkbox">
                <input
                  id="unlock-send-email-checkbox"
                  type="checkbox"
                  disabled={isStatusActionPending}
                  checked={unlockSendEmail}
                  onChange={(event) => setUnlockSendEmail(event.target.checked)}
                />
                <span className="admin-checkbox__box admin-checkbox__box--primary" aria-hidden="true">
                  <span className="material-symbols-outlined">check</span>
                </span>
                <span>Gửi email thông báo kích hoạt lại</span>
              </label>

              <div className="admin-modal__actions">
                <button
                  className="admin-modal-button admin-modal-button--secondary"
                  id="btn-cancel-unlock"
                  type="button"
                  disabled={isStatusActionPending}
                  onClick={closeModals}
                >
                  Hủy
                </button>
                <button
                  className="admin-modal-button admin-modal-button--primary"
                  id="btn-submit-unlock"
                  type="submit"
                  disabled={isStatusActionPending}
                >
                  {isStatusActionPending ? 'Đang mở khóa...' : 'Mở khóa Ngay'}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default AdminUserManagementPage
