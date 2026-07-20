import { useCallback, useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import * as partnerApi from '../services/partnerApi.js'

const EMPTY_FORM = { fullName: '', email: '', phoneNumber: '' }

function StatusBadge({ staff }) {
  if (staff.status === 'LOCKED') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#ffdad6] text-[#93000a]">
        Đã khóa
      </span>
    )
  }
  if (!staff.activated) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#fff3cd] text-[#7a5b00]">
        Chờ kích hoạt
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#cdf5d8] text-[#0c5132]">
      Đang hoạt động
    </span>
  )
}

export default function PartnerStaffPage() {
  const [staff, setStaff] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [actionId, setActionId] = useState(null)

  // Modal phân công
  const [assignTarget, setAssignTarget] = useState(null) // staff đang phân công
  const [attractions, setAttractions] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [assignLoading, setAssignLoading] = useState(false)
  const [savingAssign, setSavingAssign] = useState(false)

  useEffect(() => {
    document.title = 'Quản lý Nhân viên | VietTicket B2B'
  }, [])

  const fetchStaff = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await partnerApi.listStaff()
      setStaff(res.data || [])
    } catch (err) {
      toast.error(err.message || 'Không thể tải danh sách nhân viên.')
      setStaff([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchStaff()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchStaff])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!form.fullName.trim() || !form.email.trim()) {
      toast.warning('Vui lòng nhập họ tên và email.')
      return
    }
    setCreating(true)
    try {
      await partnerApi.createStaff({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        phoneNumber: form.phoneNumber.trim() || undefined,
      })
      toast.success('Đã tạo nhân viên và gửi email mời đặt mật khẩu.')
      setShowCreate(false)
      setForm(EMPTY_FORM)
      void fetchStaff()
    } catch (err) {
      toast.error(err.message || 'Không thể tạo nhân viên.')
    } finally {
      setCreating(false)
    }
  }

  const handleToggleStatus = async (member) => {
    const nextStatus = member.status === 'LOCKED' ? 'ACTIVE' : 'LOCKED'
    setActionId(member.id)
    try {
      await partnerApi.changeStaffStatus(member.id, nextStatus)
      toast.success(nextStatus === 'LOCKED' ? 'Đã khóa nhân viên.' : 'Đã mở khóa nhân viên.')
      void fetchStaff()
    } catch (err) {
      toast.error(err.message || 'Không thể đổi trạng thái.')
    } finally {
      setActionId(null)
    }
  }

  const handleResendInvite = async (member) => {
    setActionId(member.id)
    try {
      await partnerApi.resendStaffInvite(member.id)
      toast.success('Đã gửi lại email mời.')
    } catch (err) {
      toast.error(err.message || 'Không thể gửi lại email mời.')
    } finally {
      setActionId(null)
    }
  }

  const handleRemove = async (member) => {
    if (!window.confirm(`Gỡ nhân viên "${member.fullName}" khỏi công ty? Tài khoản sẽ bị khóa và thu hồi mọi phân công.`)) {
      return
    }
    setActionId(member.id)
    try {
      await partnerApi.removeStaff(member.id)
      toast.success('Đã gỡ nhân viên khỏi công ty.')
      void fetchStaff()
    } catch (err) {
      toast.error(err.message || 'Không thể gỡ nhân viên.')
    } finally {
      setActionId(null)
    }
  }

  const openAssign = async (member) => {
    setAssignTarget(member)
    setAssignLoading(true)
    try {
      const res = await partnerApi.getStaffAssignments(member.id)
      setAttractions(res.data?.attractions || [])
      setSelectedIds(res.data?.assignedAttractionIds || [])
    } catch (err) {
      toast.error(err.message || 'Không thể tải dữ liệu phân công.')
      setAssignTarget(null)
    } finally {
      setAssignLoading(false)
    }
  }

  const toggleAttraction = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const saveAssignments = async () => {
    if (!assignTarget) return
    setSavingAssign(true)
    try {
      await partnerApi.replaceStaffAssignments(assignTarget.id, selectedIds)
      toast.success('Đã cập nhật phân công địa điểm.')
      setAssignTarget(null)
      void fetchStaff()
    } catch (err) {
      toast.error(err.message || 'Không thể cập nhật phân công.')
    } finally {
      setSavingAssign(false)
    }
  }

  return (
    <PartnerLayout pageTitle="Quản lý Nhân viên">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[#191c1d]">Nhân viên của bạn</h2>
          <p className="text-sm text-[#3f484a]">
            Tạo và phân công nhân viên check-in tại các địa điểm của bạn. Hoàn tiền do nhân viên nền tảng xử lý.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 bg-[#006068] hover:bg-[#00474d] text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
        >
          <span className="material-symbols-outlined text-[20px]">person_add</span>
          Thêm nhân viên
        </button>
      </div>

      <div className="bg-white rounded-xl border border-[#e1e3e4] overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-[#3f484a]">Đang tải…</div>
        ) : staff.length === 0 ? (
          <div className="p-10 text-center text-[#3f484a]">
            Chưa có nhân viên nào. Nhấn “Thêm nhân viên” để bắt đầu.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f2f4f5] text-left text-[#3f484a]">
                  <th className="px-4 py-3 font-semibold">Nhân viên</th>
                  <th className="px-4 py-3 font-semibold">Trạng thái</th>
                  <th className="px-4 py-3 font-semibold">Địa điểm phân công</th>
                  <th className="px-4 py-3 font-semibold text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((member) => (
                  <tr key={member.id} className="border-t border-[#e1e3e4]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#191c1d]">{member.fullName}</div>
                      <div className="text-[#3f484a]">{member.email}</div>
                      {member.phoneNumber && (
                        <div className="text-xs text-[#6f7f82]">{member.phoneNumber}</div>
                      )}
                    </td>
                    <td className="px-4 py-3"><StatusBadge staff={member} /></td>
                    <td className="px-4 py-3">
                      {member.assignments.length === 0 ? (
                        <span className="text-[#6f7f82]">Chưa phân công</span>
                      ) : (
                        <span className="text-[#191c1d]">
                          {member.assignments.map((a) => a.title).filter(Boolean).join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end flex-wrap">
                        <button
                          onClick={() => openAssign(member)}
                          className="text-[#006068] hover:bg-[#e0f3f4] px-2.5 py-1.5 rounded-md text-xs font-semibold"
                        >
                          Phân công
                        </button>
                        {!member.activated && (
                          <button
                            disabled={actionId === member.id}
                            onClick={() => handleResendInvite(member)}
                            className="text-[#7a5b00] hover:bg-[#fff3cd] px-2.5 py-1.5 rounded-md text-xs font-semibold disabled:opacity-50"
                          >
                            Gửi lại lời mời
                          </button>
                        )}
                        <button
                          disabled={actionId === member.id}
                          onClick={() => handleToggleStatus(member)}
                          className="text-[#003558] hover:bg-[#cfe5ff] px-2.5 py-1.5 rounded-md text-xs font-semibold disabled:opacity-50"
                        >
                          {member.status === 'LOCKED' ? 'Mở khóa' : 'Khóa'}
                        </button>
                        <button
                          disabled={actionId === member.id}
                          onClick={() => handleRemove(member)}
                          className="text-[#ba1a1a] hover:bg-[#ffdad6] px-2.5 py-1.5 rounded-md text-xs font-semibold disabled:opacity-50"
                        >
                          Gỡ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal tạo nhân viên */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !creating && setShowCreate(false)}>
          <form
            className="bg-white rounded-xl w-full max-w-md p-6 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreate}
          >
            <h3 className="text-lg font-semibold text-[#191c1d]">Thêm nhân viên</h3>
            <p className="text-sm text-[#3f484a] -mt-2">
              Nhân viên sẽ nhận email để tự đặt mật khẩu và kích hoạt tài khoản.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-[#3f484a]">Họ tên</span>
              <input
                className="border border-[#bec8ca] rounded-lg px-3 py-2 focus:outline-none focus:border-[#006068]"
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                placeholder="Nguyễn Văn A"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-[#3f484a]">Email</span>
              <input
                type="email"
                className="border border-[#bec8ca] rounded-lg px-3 py-2 focus:outline-none focus:border-[#006068]"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="nhanvien@congty.com"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-[#3f484a]">Số điện thoại (tùy chọn)</span>
              <input
                className="border border-[#bec8ca] rounded-lg px-3 py-2 focus:outline-none focus:border-[#006068]"
                value={form.phoneNumber}
                onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))}
                placeholder="09xxxxxxxx"
              />
            </label>
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-[#3f484a] hover:bg-[#eceeef]"
                disabled={creating}
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#006068] text-white hover:bg-[#00474d] disabled:opacity-50"
              >
                {creating ? 'Đang tạo…' : 'Tạo & gửi lời mời'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal phân công địa điểm */}
      {assignTarget && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !savingAssign && setAssignTarget(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg p-6 flex flex-col gap-4 max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-semibold text-[#191c1d]">Phân công địa điểm</h3>
              <p className="text-sm text-[#3f484a]">{assignTarget.fullName} — {assignTarget.email}</p>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col gap-1">
              {assignLoading ? (
                <div className="py-8 text-center text-[#3f484a]">Đang tải…</div>
              ) : attractions.length === 0 ? (
                <div className="py-8 text-center text-[#3f484a]">
                  Bạn chưa có địa điểm nào để phân công.
                </div>
              ) : (
                attractions.map((a) => (
                  <label key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#f2f4f5] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(a.id)}
                      onChange={() => toggleAttraction(a.id)}
                      className="w-4 h-4 accent-[#006068]"
                    />
                    <span className="flex-1">
                      <span className="text-[#191c1d]">{a.title}</span>
                      {a.city && <span className="text-xs text-[#6f7f82]"> · {a.city}</span>}
                    </span>
                  </label>
                ))
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#e1e3e4] pt-4">
              <button
                onClick={() => setAssignTarget(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-[#3f484a] hover:bg-[#eceeef]"
                disabled={savingAssign}
              >
                Hủy
              </button>
              <button
                onClick={saveAssignments}
                disabled={savingAssign || assignLoading}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#006068] text-white hover:bg-[#00474d] disabled:opacity-50"
              >
                {savingAssign ? 'Đang lưu…' : 'Lưu phân công'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PartnerLayout>
  )
}
