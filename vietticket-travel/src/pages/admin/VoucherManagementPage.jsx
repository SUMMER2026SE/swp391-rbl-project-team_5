import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout'
import {
  createVoucher,
  getVouchers,
  updateVoucher,
} from '../../services/adminApi'
import '../../styles/admin.css'

const PAGE_SIZE = 20

const EMPTY_FORM = {
  code: '',
  discountType: 'PERCENTAGE',
  discountValue: '',
  maxDiscount: '',
  minSpend: '',
  expiryDate: '',
  usageLimit: '',
  isActive: true,
}

const STATUS_LABELS = {
  ACTIVE: ['Đang áp dụng', 'admin-status-badge--approved'],
  INACTIVE: ['Đã tắt', 'admin-status-badge--inactive'],
  EXPIRED: ['Hết hạn', 'admin-status-badge--rejected'],
  EXHAUSTED: ['Hết lượt', 'admin-status-badge--pending'],
}

function toDateTimeLocal(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localTime.toISOString().slice(0, 16)
}

function formatVnd(value) {
  if (value == null) return 'Không giới hạn'
  return `${Number(value).toLocaleString('vi-VN')} VND`
}

function voucherToForm(voucher) {
  return {
    code: voucher.code,
    discountType: voucher.discountType,
    discountValue: String(voucher.discountValue),
    maxDiscount: voucher.maxDiscount == null ? '' : String(voucher.maxDiscount),
    minSpend: voucher.minSpend == null ? '' : String(voucher.minSpend),
    expiryDate: toDateTimeLocal(voucher.expiryDate),
    usageLimit: voucher.usageLimit == null ? '' : String(voucher.usageLimit),
    isActive: voucher.isActive,
  }
}

function buildPayload(form) {
  const expiryDate = new Date(form.expiryDate)
  if (Number.isNaN(expiryDate.getTime())) {
    throw new Error('invalid-expiry')
  }

  return {
    code: form.code,
    discountType: form.discountType,
    discountValue: form.discountValue,
    maxDiscount: form.discountType === 'PERCENTAGE' ? form.maxDiscount || null : null,
    minSpend: form.minSpend || null,
    expiryDate: expiryDate.toISOString(),
    usageLimit: form.usageLimit || null,
    isActive: form.isActive,
  }
}

export default function VoucherManagementPage() {
  const [vouchers, setVouchers] = useState([])
  const [pagination, setPagination] = useState({
    page: 1,
    total: 0,
    totalPages: 1,
  })
  const [page, setPage] = useState(1)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingVoucher, setEditingVoucher] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const requestParams = {
    page,
    limit: PAGE_SIZE,
    search,
    isActive:
      statusFilter === 'active'
        ? true
        : statusFilter === 'inactive'
          ? false
          : undefined,
  }

  const loadVouchers = async () => {
    setLoading(true)
    try {
      const response = await getVouchers(requestParams)
      const nextPagination = response.pagination || { page, total: 0, totalPages: 1 }
      if (page > nextPagination.totalPages) {
        setPage(nextPagination.totalPages)
        return
      }
      setVouchers(response.data || [])
      setPagination(nextPagination)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    getVouchers(requestParams)
      .then((response) => {
        if (!active) return
        const nextPagination = response.pagination || { page, total: 0, totalPages: 1 }
        if (page > nextPagination.totalPages) {
          setPage(nextPagination.totalPages)
          return
        }
        setVouchers(response.data || [])
        setPagination(nextPagination)
      })
      .catch((error) => {
        if (active) toast.error(error.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
    // Each primitive below defines the server-side query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, search, statusFilter])

  const resetForm = () => {
    setEditingVoucher(null)
    setForm(EMPTY_FORM)
  }

  const startEdit = (voucher) => {
    setEditingVoucher(voucher)
    setForm(voucherToForm(voucher))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return

    let payload
    try {
      payload = buildPayload(form)
    } catch {
      toast.error('Thời hạn voucher không hợp lệ.')
      return
    }

    setSaving(true)
    try {
      if (editingVoucher) {
        if (editingVoucher.usedCount > 0) {
          payload = {
            expiryDate: payload.expiryDate,
            usageLimit: payload.usageLimit,
            isActive: payload.isActive,
          }
        }
        await updateVoucher(editingVoucher.id, payload)
        toast.success('Đã cập nhật voucher.')
      } else {
        await createVoucher(payload)
        toast.success('Đã tạo voucher.')
      }
      resetForm()
      await loadVouchers()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleVoucher = async (voucher) => {
    try {
      const response = await updateVoucher(voucher.id, { isActive: !voucher.isActive })
      const updated = response.data
      toast.success(updated.isActive ? 'Đã bật voucher.' : 'Đã tắt voucher.')
      await loadVouchers()
    } catch (error) {
      toast.error(error.message)
    }
  }

  const handleSearch = (event) => {
    event.preventDefault()
    const nextSearch = searchInput.trim()
    if (page === 1 && search === nextSearch) {
      loadVouchers()
      return
    }
    setLoading(true)
    setPage(1)
    setSearch(nextSearch)
  }

  const financialTermsLocked = Boolean(editingVoucher?.usedCount)

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm voucher...">
      <div className="admin-page-header">
        <div>
          <h2>Quản lý voucher</h2>
          <p>Tạo mã ưu đãi có kiểm soát, theo dõi thời hạn và số lượt đã sử dụng.</p>
        </div>
      </div>

      <form
        className="admin-page-section"
        onSubmit={handleSubmit}
        style={{ padding: 24, marginBottom: 24 }}
      >
        <div className="admin-attractions-header">
          <div>
            <h3>{editingVoucher ? `Chỉnh sửa ${editingVoucher.code}` : 'Tạo voucher mới'}</h3>
            {financialTermsLocked && (
              <p style={{ color: 'var(--adm-on-surface-variant)', marginTop: 6 }}>
                Voucher đã được dùng; điều kiện tài chính được khóa để bảo toàn lịch sử đơn hàng.
              </p>
            )}
          </div>
          {editingVoucher && (
            <button className="admin-pagination__btn" type="button" onClick={resetForm}>
              Hủy chỉnh sửa
            </button>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 16,
            marginTop: 20,
          }}
        >
          <label>
            <span>Mã voucher</span>
            <input
              className="admin-form-input"
              required
              minLength={3}
              maxLength={32}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}"
              disabled={financialTermsLocked}
              value={form.code}
              onChange={(event) =>
                setForm({ ...form, code: event.target.value.toUpperCase() })
              }
              placeholder="WELCOME10"
            />
          </label>
          <label>
            <span>Loại ưu đãi</span>
            <select
              className="admin-form-input"
              disabled={financialTermsLocked}
              value={form.discountType}
              onChange={(event) =>
                setForm({
                  ...form,
                  discountType: event.target.value,
                  maxDiscount: event.target.value === 'FIXED' ? '' : form.maxDiscount,
                })
              }
            >
              <option value="PERCENTAGE">Theo phần trăm</option>
              <option value="FIXED">Số tiền cố định</option>
            </select>
          </label>
          <label>
            <span>{form.discountType === 'PERCENTAGE' ? 'Phần trăm giảm' : 'Số tiền giảm (VND)'}</span>
            <input
              className="admin-form-input"
              type="number"
              required
              min={1}
              max={form.discountType === 'PERCENTAGE' ? 100 : 9_999_999_999}
              step={1}
              disabled={financialTermsLocked}
              value={form.discountValue}
              onChange={(event) => setForm({ ...form, discountValue: event.target.value })}
            />
          </label>
          <label>
            <span>Giảm tối đa (VND)</span>
            <input
              className="admin-form-input"
              type="number"
              min={1}
              max={9_999_999_999}
              step={1}
              disabled={form.discountType === 'FIXED' || financialTermsLocked}
              value={form.maxDiscount}
              onChange={(event) => setForm({ ...form, maxDiscount: event.target.value })}
              placeholder="Không giới hạn"
            />
          </label>
          <label>
            <span>Đơn tối thiểu (VND)</span>
            <input
              className="admin-form-input"
              type="number"
              min={0}
              max={9_999_999_999}
              step={1}
              disabled={financialTermsLocked}
              value={form.minSpend}
              onChange={(event) => setForm({ ...form, minSpend: event.target.value })}
              placeholder="Không yêu cầu"
            />
          </label>
          <label>
            <span>Hết hạn</span>
            <input
              className="admin-form-input"
              type="datetime-local"
              required
              value={form.expiryDate}
              onChange={(event) => setForm({ ...form, expiryDate: event.target.value })}
            />
          </label>
          <label>
            <span>Giới hạn lượt dùng</span>
            <input
              className="admin-form-input"
              type="number"
              min={Math.max(1, editingVoucher?.usedCount || 0)}
              max={1_000_000}
              step={1}
              value={form.usageLimit}
              onChange={(event) => setForm({ ...form, usageLimit: event.target.value })}
              placeholder="Không giới hạn"
            />
          </label>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 18 }}>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
          />
          Cho phép áp dụng voucher
        </label>
        <button className="admin-export-btn" type="submit" disabled={saving} style={{ marginTop: 18 }}>
          <span className="material-symbols-outlined">{editingVoucher ? 'save' : 'add'}</span>
          {saving ? 'Đang lưu...' : editingVoucher ? 'Lưu thay đổi' : 'Tạo voucher'}
        </button>
      </form>

      <section className="admin-page-section">
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #e1e3e4',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, flex: '1 1 280px' }}>
            <label className="sr-only" htmlFor="voucher-search">Tìm mã voucher</label>
            <input
              id="voucher-search"
              className="admin-form-input"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Tìm theo mã voucher"
            />
            <button className="admin-pagination__btn" type="submit">Tìm</button>
          </form>
          <label>
            <span className="sr-only">Lọc trạng thái voucher</span>
            <select
              className="admin-form-input"
              value={statusFilter}
              onChange={(event) => {
                setLoading(true)
                setPage(1)
                setStatusFilter(event.target.value)
              }}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang bật</option>
              <option value="inactive">Đã tắt</option>
            </select>
          </label>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Ưu đãi</th>
                <th>Điều kiện</th>
                <th>Lượt dùng</th>
                <th>Hết hạn</th>
                <th>Trạng thái</th>
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="admin-empty-state">Đang tải...</td></tr>
              ) : vouchers.length === 0 ? (
                <tr><td colSpan={7} className="admin-empty-state">Chưa có voucher phù hợp.</td></tr>
              ) : vouchers.map((voucher) => {
                const [statusLabel, statusClass] =
                  STATUS_LABELS[voucher.operationalStatus] || STATUS_LABELS.INACTIVE
                return (
                  <tr key={voucher.id}>
                    <td><strong>{voucher.code}</strong></td>
                    <td>
                      {voucher.discountType === 'PERCENTAGE'
                        ? `${voucher.discountValue}%${voucher.maxDiscount ? `, tối đa ${formatVnd(voucher.maxDiscount)}` : ''}`
                        : formatVnd(voucher.discountValue)}
                    </td>
                    <td>Từ {formatVnd(voucher.minSpend || 0)}</td>
                    <td>
                      {voucher.usedCount.toLocaleString('vi-VN')} /{' '}
                      {voucher.usageLimit == null
                        ? '∞'
                        : voucher.usageLimit.toLocaleString('vi-VN')}
                    </td>
                    <td>{new Date(voucher.expiryDate).toLocaleString('vi-VN')}</td>
                    <td>
                      <span className={`admin-status-badge ${statusClass}`}>{statusLabel}</span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="admin-pagination__btn"
                        type="button"
                        onClick={() => startEdit(voucher)}
                        aria-label={`Chỉnh sửa ${voucher.code}`}
                      >
                        <span className="material-symbols-outlined">edit</span>
                      </button>
                      <button
                        className="admin-pagination__btn"
                        type="button"
                        onClick={() => toggleVoucher(voucher)}
                        aria-label={`${voucher.isActive ? 'Tắt' : 'Bật'} ${voucher.code}`}
                      >
                        <span className="material-symbols-outlined">
                          {voucher.isActive ? 'toggle_off' : 'toggle_on'}
                        </span>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div
          style={{
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span>
            {pagination.total.toLocaleString('vi-VN')} voucher · Trang {pagination.page}/{pagination.totalPages}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="admin-pagination__btn"
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => {
                setLoading(true)
                setPage((value) => Math.max(1, value - 1))
              }}
            >
              Trước
            </button>
            <button
              className="admin-pagination__btn"
              type="button"
              disabled={page >= pagination.totalPages || loading}
              onClick={() => {
                setLoading(true)
                setPage((value) => value + 1)
              }}
            >
              Sau
            </button>
          </div>
        </div>
      </section>
    </AdminLayout>
  )
}
