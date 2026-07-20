import { useEffect, useMemo, useState } from 'react'
import { toast } from 'react-toastify'
import AdminLayout from '../../layouts/AdminLayout'
import {
  createCategory,
  deleteCategory,
  getCategories,
  updateCategory,
} from '../../services/adminApi'
import '../../styles/admin.css'

const EMPTY_FORM = {
  name: '',
  description: '',
  icon: 'category',
  isActive: true,
}

const CATEGORY_ICON_OPTIONS = [
  { value: 'category', label: 'Danh mục chung' },
  { value: 'museum', label: 'Bảo tàng và di sản' },
  { value: 'theater_comedy', label: 'Văn hóa và nghệ thuật' },
  { value: 'sailing', label: 'Phiêu lưu và đường thủy' },
  { value: 'park', label: 'Thiên nhiên' },
  { value: 'attractions', label: 'Công viên giải trí' },
  { value: 'mood', label: 'Vui chơi' },
]

export default function CategoryManagementPage() {
  const [categories, setCategories] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadCategories = async () => {
    try {
      const response = await getCategories()
      setCategories(response.data || [])
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    getCategories()
      .then((response) => {
        if (active) setCategories(response.data || [])
      })
      .catch((error) => toast.error(error.message))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const visibleCategories = useMemo(
    () => categories.filter((item) => {
      if (filter === 'active') return item.isActive
      if (filter === 'hidden') return !item.isActive
      return true
    }),
    [categories, filter],
  )

  const activeCount = categories.filter((item) => item.isActive).length
  const attractionCount = categories.reduce((sum, item) => sum + (item.attractionCount || 0), 0)

  const resetForm = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSaving(true)
    try {
      if (editingId) {
        await updateCategory(editingId, form)
        toast.success('Đã cập nhật danh mục.')
      } else {
        await createCategory(form)
        toast.success('Đã tạo danh mục.')
      }
      resetForm()
      await loadCategories()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (category) => {
    setEditingId(category.id)
    setForm({
      name: category.name,
      description: category.description,
      icon: category.icon,
      isActive: category.isActive,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const toggleCategory = async (category) => {
    try {
      await updateCategory(category.id, { isActive: !category.isActive })
      setCategories((items) =>
        items.map((item) =>
          item.id === category.id ? { ...item, isActive: !item.isActive } : item,
        ),
      )
      toast.success(category.isActive ? 'Đã ẩn danh mục.' : 'Đã hiển thị danh mục.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  const removeCategory = async (category) => {
    if (!window.confirm(`Xóa danh mục "${category.name}"?`)) return
    try {
      await deleteCategory(category.id)
      setCategories((items) => items.filter((item) => item.id !== category.id))
      if (editingId === category.id) resetForm()
      toast.success('Đã xóa danh mục.')
    } catch (error) {
      toast.error(error.message)
    }
  }

  return (
    <AdminLayout searchPlaceholder="Tìm kiếm danh mục...">
      <div className="admin-page-header">
        <div>
          <h2>Danh mục du lịch</h2>
          <p>Danh mục bị ẩn sẽ không xuất hiện trong biểu mẫu tạo điểm tham quan.</p>
        </div>
      </div>

      <div className="admin-mini-stats-grid">
        {[
          ['category', 'Tổng danh mục', categories.length],
          ['visibility', 'Đang hiển thị', activeCount],
          ['map', 'Lượt gắn địa điểm', attractionCount],
        ].map(([icon, label, value]) => (
          <div className="admin-page-section" key={label} style={{ padding: 20 }}>
            <span aria-hidden="true" className="material-symbols-outlined" style={{ color: 'var(--adm-primary-dark)' }}>
              {icon}
            </span>
            <p style={{ color: 'var(--adm-on-surface-variant)', marginTop: 10 }}>{label}</p>
            <strong style={{ fontSize: 24 }}>{value}</strong>
          </div>
        ))}
      </div>

      <form className="admin-page-section" onSubmit={handleSubmit} style={{ padding: 24, marginBottom: 24 }}>
        <div className="admin-attractions-header">
          <h3>{editingId ? 'Chỉnh sửa danh mục' : 'Thêm danh mục mới'}</h3>
          {editingId && (
            <button className="admin-pagination__btn" type="button" onClick={resetForm}>
              Hủy chỉnh sửa
            </button>
          )}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(180px, 1fr) minmax(260px, 2fr) minmax(150px, 1fr)',
            gap: 16,
            marginTop: 20,
          }}
        >
          <label>
            <span className="sr-only">Tên danh mục</span>
            <input
              className="admin-form-input"
              required
              maxLength={80}
              placeholder="Tên danh mục"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label>
            <span className="sr-only">Mô tả</span>
            <input
              className="admin-form-input"
              maxLength={300}
              placeholder="Mô tả ngắn"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <label>
            <span className="sr-only">Biểu tượng danh mục</span>
            <select
              aria-label="Biểu tượng danh mục"
              className="admin-form-input"
              value={form.icon}
              onChange={(event) => setForm({ ...form, icon: event.target.value })}
            >
              {CATEGORY_ICON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
          />
          Hiển thị danh mục
        </label>
        <button className="admin-export-btn" type="submit" disabled={saving} style={{ marginTop: 18 }}>
          <span aria-hidden="true" className="material-symbols-outlined">{editingId ? 'save' : 'add'}</span>
          {saving ? 'Đang lưu...' : editingId ? 'Lưu thay đổi' : 'Thêm danh mục'}
        </button>
      </form>

      <section className="admin-page-section">
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e1e3e4' }}>
          <select aria-label="Lọc danh mục theo trạng thái" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">Tất cả trạng thái</option>
            <option value="active">Đang hiển thị</option>
            <option value="hidden">Đang ẩn</option>
          </select>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Danh mục</th>
                <th>Mô tả</th>
                <th>Điểm tham quan</th>
                <th>Trạng thái</th>
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="admin-empty-state">Đang tải...</td></tr>
              ) : visibleCategories.length === 0 ? (
                <tr><td colSpan={5} className="admin-empty-state">Chưa có danh mục phù hợp.</td></tr>
              ) : visibleCategories.map((category) => (
                <tr key={category.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className="admin-cat-icon">
                        <span aria-hidden="true" className="material-symbols-outlined">{category.icon}</span>
                      </div>
                      <strong>{category.name}</strong>
                    </div>
                  </td>
                  <td>{category.description || 'Mô tả đang chờ quản trị viên cập nhật.'}</td>
                  <td>{category.attractionCount}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => toggleCategory(category)}
                      className={`admin-status-badge ${
                        category.isActive ? 'admin-status-badge--approved' : 'admin-status-badge--inactive'
                      }`}
                    >
                      {category.isActive ? 'Hiển thị' : 'Đang ẩn'}
                    </button>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button aria-label={`Chỉnh sửa ${category.name}`} className="admin-pagination__btn" type="button" onClick={() => startEdit(category)}>
                      <span aria-hidden="true" className="material-symbols-outlined">edit</span>
                    </button>
                    <button
                      className="admin-pagination__btn"
                      type="button"
                      disabled={category.attractionCount > 0}
                      title={category.attractionCount > 0 ? 'Danh mục đang được sử dụng' : 'Xóa danh mục'}
                      aria-label={`Xóa ${category.name}`}
                      onClick={() => removeCategory(category)}
                    >
                      <span aria-hidden="true" className="material-symbols-outlined">delete</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AdminLayout>
  )
}
