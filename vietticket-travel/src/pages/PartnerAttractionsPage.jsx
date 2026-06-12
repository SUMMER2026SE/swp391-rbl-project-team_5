import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import * as partnerApi from '../services/partnerApi.js'

const ITEMS_PER_PAGE = 10

function StatusBadge({ status }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#E6F4EA] text-[#137333] border border-[#CEEAD6]">
        Hoạt động
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#e6e8e9] text-[#3f484a] border border-[#bec8ca]">
      Tạm dừng
    </span>
  )
}

function PartnerAttractionsPage() {
  const navigate = useNavigate()
  const [attractions, setAttractions] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [viewMode, setViewMode] = useState('table') // 'table' | 'grid'
  const [deleteTarget, setDeleteTarget] = useState(null) // { id, name }

  useEffect(() => {
    document.title = 'Quản lý Điểm tham quan | VietTicket B2B'
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const data = await partnerApi.listAttractions()
        if (active) setAttractions(data.attractions)
      } catch (err) {
        if (active) setAttractions([])
        toast.error(err.message)
      }
    })()
    return () => { active = false }
  }, [])

  // Filter logic
  const filtered = attractions.filter((a) => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase())
    const matchStatus = !statusFilter || a.status === statusFilter
    const matchCity = !cityFilter || a.city.toLowerCase().includes(cityFilter.toLowerCase())
    return matchSearch && matchStatus && matchCity
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const paginated = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)

  const handleDelete = (id, name) => {
    setDeleteTarget({ id, name })
  }

  const confirmDelete = async () => {
    const target = deleteTarget
    try {
      await partnerApi.deleteAttraction(target.id)
      setAttractions((prev) => prev.filter((a) => a.id !== target.id))
      toast.success(`Đã xóa "${target.name}".`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDeleteTarget(null)
    }
  }

  const handleEdit = (id) => {
    navigate(`/partner/attractions/${id}/edit`)
  }

  const handleView = (id) => {
    navigate(`/partner/attractions/${id}/tickets`)
  }

  return (
    <PartnerLayout pageTitle="Attractions Management">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl md:text-3xl font-semibold text-[#191c1d]">Điểm tham quan của tôi</h2>
          <p className="text-base text-[#3f484a] mt-1">Quản lý các điểm tham quan và trải nghiệm của bạn.</p>
        </div>
        <button
          onClick={() => navigate('/partner/attractions/new')}
          className="bg-[#006068] hover:bg-[#00474d] text-white px-6 py-3 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors duration-200 shadow-sm flex-shrink-0"
        >
          <span className="material-symbols-outlined">add</span>
          Thêm điểm tham quan
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl shadow-[0px_4px_20px_rgba(0,40,50,0.05)] flex flex-col lg:flex-row gap-4 items-center justify-between border border-[#e1e3e4]">
        <div className="flex flex-col sm:flex-row gap-4 w-full lg:w-auto flex-1">
          {/* Search */}
          <div className="relative w-full sm:max-w-xs">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#6f797a] text-[20px]">
              search
            </span>
            <input
              type="text"
              placeholder="Tìm kiếm theo tên..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1) }}
              className="w-full pl-10 pr-4 py-2 bg-[#f8fafb] border border-[#bec8ca] rounded-lg focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] focus:outline-none transition-shadow text-sm text-[#191c1d] placeholder-[#6f797a]"
            />
          </div>

          {/* Status Filter */}
          <div className="flex gap-2 w-full sm:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1) }}
              className="px-4 py-2 bg-[#f8fafb] border border-[#bec8ca] rounded-lg focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] focus:outline-none transition-shadow text-sm text-[#191c1d] w-full sm:w-auto"
            >
              <option value="">Trạng thái: Tất cả</option>
              <option value="active">Hoạt động</option>
              <option value="inactive">Tạm dừng</option>
            </select>

            {/* City Filter */}
            <select
              value={cityFilter}
              onChange={(e) => { setCityFilter(e.target.value); setCurrentPage(1) }}
              className="px-4 py-2 bg-[#f8fafb] border border-[#bec8ca] rounded-lg focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] focus:outline-none transition-shadow text-sm text-[#191c1d] w-full sm:w-auto"
            >
              <option value="">Thành phố: Tất cả</option>
              <option value="Đà Nẵng">Đà Nẵng</option>
              <option value="Quảng Ninh">Quảng Ninh</option>
              <option value="Khánh Hòa">Khánh Hòa</option>
              <option value="Quảng Nam">Quảng Nam</option>
            </select>
          </div>
        </div>

        {/* View Toggle */}
        <div className="hidden sm:flex items-center gap-2 border-l border-[#bec8ca] pl-4">
          <button
            onClick={() => setViewMode('table')}
            title="Dạng bảng"
            className={`p-2 rounded-md transition-colors ${viewMode === 'table' ? 'text-[#00474d] bg-[#cfe5ff]' : 'text-[#3f484a] hover:text-[#00474d] hover:bg-[#eceeef]'}`}
          >
            <span className="material-symbols-outlined" style={viewMode === 'table' ? { fontVariationSettings: "'FILL' 1" } : {}}>
              table_rows
            </span>
          </button>
          <button
            onClick={() => setViewMode('grid')}
            title="Dạng lưới"
            className={`p-2 rounded-md transition-colors ${viewMode === 'grid' ? 'text-[#00474d] bg-[#cfe5ff]' : 'text-[#3f484a] hover:text-[#00474d] hover:bg-[#eceeef]'}`}
          >
            <span className="material-symbols-outlined">grid_view</span>
          </button>
        </div>
      </div>

      {/* Table / Grid */}
      {viewMode === 'table' ? (
        <TableView
          rows={paginated}
          onView={handleView}
          onEdit={handleEdit}
          onDelete={handleDelete}
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filtered.length}
          onPageChange={setCurrentPage}
        />
      ) : (
        <GridView
          rows={paginated}
          onView={handleView}
          onEdit={handleEdit}
          onDelete={handleDelete}
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={filtered.length}
          onPageChange={setCurrentPage}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-[#ffdad6] flex items-center justify-center">
                <span className="material-symbols-outlined text-[#ba1a1a]">delete</span>
              </div>
              <h3 className="text-base font-bold text-[#191c1d]">Xóa điểm tham quan</h3>
            </div>
            <p className="text-sm text-[#3f484a] mb-6">
              Bạn có chắc muốn xóa <strong>"{deleteTarget.name}"</strong>? Toàn bộ gói vé và lịch liên quan sẽ bị xóa theo. Thao tác này không thể hoàn tác.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-lg border border-[#bec8ca] text-[#191c1d] text-sm font-medium hover:bg-[#f2f4f5] transition-colors">Hủy</button>
              <button onClick={confirmDelete} className="px-4 py-2 rounded-lg bg-[#ba1a1a] text-white text-sm font-medium hover:bg-[#93000a] transition-colors">Xóa</button>
            </div>
          </div>
        </div>
      )}
    </PartnerLayout>
  )
}

/* ── Table View ── */
function TableView({ rows, onView, onEdit, onDelete, currentPage, totalPages, totalItems, onPageChange }) {
  return (
    <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(0,40,50,0.05)] border border-[#e1e3e4] overflow-hidden flex flex-col flex-1">
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left border-collapse">
          <thead className="bg-[#f2f4f5] border-b border-[#e1e3e4] sticky top-0 z-10">
            <tr>
              {['Điểm tham quan', 'Địa điểm', 'Giờ mở cửa', 'Trạng thái', ''].map((h) => (
                <th key={h} className="px-6 py-4 text-xs font-semibold text-[#3f484a] uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e1e3e4] bg-white">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-16 text-center text-[#6f797a] text-sm">
                  <span className="material-symbols-outlined text-4xl block mb-2 text-[#bec8ca]">search_off</span>
                  Không tìm thấy điểm tham quan nào.
                </td>
              </tr>
            ) : (
              rows.map((a) => (
                <tr key={a.id} className="hover:bg-[#f8fafb] transition-colors group cursor-pointer">
                  {/* Attraction */}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-12 rounded-md overflow-hidden bg-[#d8dadb] flex-shrink-0 flex items-center justify-center">
                        {a.image ? (
                          <img
                            src={a.image}
                            alt={a.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <span className="material-symbols-outlined text-[#6f797a]">image</span>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[#191c1d]">{a.name}</p>
                        <p className="text-xs text-[#3f484a]">{a.category}</p>
                      </div>
                    </div>
                  </td>
                  {/* Location */}
                  <td className="px-6 py-4">
                    <p className="text-base text-[#191c1d]">{a.city}</p>
                    <p className="text-xs text-[#3f484a] truncate max-w-[12rem]">{a.district}</p>
                  </td>
                  {/* Hours */}
                  <td className="px-6 py-4 text-base text-[#191c1d]">{a.hours}</td>
                  {/* Status */}
                  <td className="px-6 py-4">
                    <StatusBadge status={a.status} />
                  </td>
                  {/* Actions */}
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ActionBtn icon="visibility" title="Xem" onClick={() => onView(a.id)} hoverColor="hover:text-[#00474d]" />
                      <ActionBtn icon="edit" title="Sửa" onClick={() => onEdit(a.id)} hoverColor="hover:text-[#00629d]" />
                      <ActionBtn icon="delete" title="Xóa" onClick={() => onDelete(a.id, a.name)} hoverColor="hover:text-[#ba1a1a]" hoverBg="hover:bg-[#ffdad6]" />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <PaginationBar currentPage={currentPage} totalPages={totalPages} totalItems={totalItems} onPageChange={onPageChange} />
    </div>
  )
}

/* ── Grid View ── */
function GridView({ rows, onView, onEdit, onDelete, currentPage, totalPages, totalItems, onPageChange }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {rows.length === 0 ? (
          <div className="col-span-full py-16 text-center text-[#6f797a] text-sm bg-white rounded-xl border border-[#e1e3e4]">
            <span className="material-symbols-outlined text-4xl block mb-2 text-[#bec8ca]">search_off</span>
            Không tìm thấy điểm tham quan nào.
          </div>
        ) : (
          rows.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm overflow-hidden group hover:shadow-md transition-shadow">
              <div className="h-40 bg-[#d8dadb] overflow-hidden flex items-center justify-center">
                {a.image ? (
                  <img
                    src={a.image}
                    alt={a.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <span className="material-symbols-outlined text-4xl text-[#6f797a]">image</span>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-bold text-[#191c1d] leading-tight">{a.name}</p>
                  <StatusBadge status={a.status} />
                </div>
                <p className="text-xs text-[#3f484a] mb-1">{a.category}</p>
                <p className="text-xs text-[#6f797a] flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">location_on</span>
                  {a.city} · {a.district}
                </p>
                <p className="text-xs text-[#6f797a] flex items-center gap-1 mt-0.5">
                  <span className="material-symbols-outlined text-[14px]">schedule</span>
                  {a.hours}
                </p>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#f2f4f5]">
                  <ActionBtn icon="visibility" title="Xem" onClick={() => onView(a.id)} hoverColor="hover:text-[#00474d]" />
                  <ActionBtn icon="edit" title="Sửa" onClick={() => onEdit(a.id)} hoverColor="hover:text-[#00629d]" />
                  <ActionBtn icon="delete" title="Xóa" onClick={() => onDelete(a.id, a.name)} hoverColor="hover:text-[#ba1a1a]" hoverBg="hover:bg-[#ffdad6]" />
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="bg-white rounded-xl border border-[#e1e3e4]">
        <PaginationBar currentPage={currentPage} totalPages={totalPages} totalItems={totalItems} onPageChange={onPageChange} />
      </div>
    </div>
  )
}

/* ── Shared Sub-components ── */
function ActionBtn({ icon, title, onClick, hoverColor = 'hover:text-[#191c1d]', hoverBg = 'hover:bg-[#eceeef]' }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-1.5 text-[#3f484a] ${hoverColor} ${hoverBg} rounded-md transition-colors`}
    >
      <span className="material-symbols-outlined text-[20px]">{icon}</span>
    </button>
  )
}

function PaginationBar({ currentPage, totalPages, totalItems, onPageChange }) {
  const pages = []
  for (let i = 1; i <= Math.min(totalPages, 5); i++) pages.push(i)

  return (
    <div className="px-6 py-4 border-t border-[#e1e3e4] flex flex-col sm:flex-row items-center justify-between gap-4">
      <p className="text-xs text-[#3f484a]">
        Hiển thị <span className="font-medium text-[#191c1d]">{totalItems}</span> kết quả
      </p>
      <nav className="flex items-center gap-1">
        <button
          disabled={currentPage === 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="p-2 rounded-md text-[#3f484a] hover:bg-[#eceeef] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">chevron_left</span>
        </button>
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`w-8 h-8 rounded-md text-xs font-medium transition-colors ${
              p === currentPage
                ? 'bg-[#cfe5ff] text-[#003558] font-bold'
                : 'text-[#3f484a] hover:bg-[#eceeef]'
            }`}
          >
            {p}
          </button>
        ))}
        {totalPages > 5 && <span className="text-[#3f484a] px-1">...</span>}
        <button
          disabled={currentPage === totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="p-2 rounded-md text-[#3f484a] hover:bg-[#eceeef] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">chevron_right</span>
        </button>
      </nav>
    </div>
  )
}

export default PartnerAttractionsPage
