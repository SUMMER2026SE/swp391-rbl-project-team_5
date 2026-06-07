/**
 * PartnerSchedulePage — Cấu hình lịch mở cửa, sức chứa và time slots.
 * Route: /partner/attractions/:id/schedule
 */
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import PartnerLayout from '../components/partner/PartnerLayout.jsx'
import * as partnerApi from '../services/partnerApi.js'

const MOCK_ATTRACTION_NAMES = {
  1: 'Sun World Ba Na Hills', 2: 'Vịnh Hạ Long Cruise',
  3: 'VinWonders Nha Trang', 4: 'Hội An Lantern Festival Tour',
}

const DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
const DAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']

const MONTHS = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12']

const DEFAULT_SLOTS = [
  { id: 's1', start: '08:00', end: '10:00', capacity: 50, isActive: true },
  { id: 's2', start: '10:00', end: '12:00', capacity: 50, isActive: true },
  { id: 's3', start: '13:00', end: '15:00', capacity: 40, isActive: true },
  { id: 's4', start: '15:00', end: '17:00', capacity: 40, isActive: true },
]

// Days that have special overrides
const DEFAULT_OVERRIDES = {
  // key: 'YYYY-MM-DD', value: { closed: bool, capacity: number }
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year, month) {
  // 0=Sun → convert to Mon=0 offset
  const d = new Date(year, month, 1).getDay()
  return d === 0 ? 6 : d - 1
}

function toKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

let _slotId = 10
const newId = () => `s${++_slotId}`

function PartnerSchedulePage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const attractionName = MOCK_ATTRACTION_NAMES[Number(id)] || 'Điểm tham quan'
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('slots') // 'slots' | 'calendar'

  // General config
  const [openDays, setOpenDays] = useState([true, true, true, true, true, true, true]) // Mon–Sun
  const [defaultCapacity, setDefaultCapacity] = useState(200)

  // Time slots
  const [slots, setSlots] = useState(DEFAULT_SLOTS)
  const [newSlot, setNewSlot] = useState({ start: '', end: '', capacity: '' })
  const [slotError, setSlotError] = useState('')

  // Calendar
  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth())
  const [overrides, setOverrides] = useState(DEFAULT_OVERRIDES)
  const [selectedDay, setSelectedDay] = useState(null) // { key, day }
  const [overrideForm, setOverrideForm] = useState({ closed: false, capacity: '' })

  useEffect(() => {
    document.title = 'Cấu hình lịch | VietTicket B2B'
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true)
    ;(async () => {
      try {
        const data = await partnerApi.getSchedule(id)
        if (!active) return
        const s = data.schedule || {}
        if (Array.isArray(s.openDays)) setOpenDays(s.openDays)
        if (typeof s.defaultCapacity === 'number') setDefaultCapacity(s.defaultCapacity)
        if (Array.isArray(s.timeSlots)) setSlots(s.timeSlots)
        if (s.specialDates && typeof s.specialDates === 'object') setOverrides(s.specialDates)
      } catch (err) {
        if (!active) return
        if (partnerApi.isNetworkError(err)) {
          // Fallback demo: giữ nguyên state mặc định đã khởi tạo
        } else {
          toast.error(err.message)
        }
      } finally {
        if (active) setIsLoading(false)
      }
    })()
    return () => { active = false }
  }, [id])

  /* ─── Slot helpers ─── */
  const addSlot = () => {
    setSlotError('')
    if (!newSlot.start || !newSlot.end) { setSlotError('Vui lòng nhập giờ bắt đầu và kết thúc.'); return }
    if (newSlot.start >= newSlot.end) { setSlotError('Giờ kết thúc phải sau giờ bắt đầu.'); return }
    const cap = Number(newSlot.capacity)
    if (!cap || cap <= 0) { setSlotError('Sức chứa phải lớn hơn 0.'); return }
    const overlap = slots.some((s) => newSlot.start < s.end && newSlot.end > s.start)
    if (overlap) { setSlotError('Khung giờ bị trùng lặp với slot hiện có.'); return }
    setSlots((prev) => [...prev, { id: newId(), start: newSlot.start, end: newSlot.end, capacity: cap, isActive: true }])
    setNewSlot({ start: '', end: '', capacity: '' })
  }

  const removeSlot = (sid) => setSlots((prev) => prev.filter((s) => s.id !== sid))
  const toggleSlot = (sid) => setSlots((prev) => prev.map((s) => s.id === sid ? { ...s, isActive: !s.isActive } : s))
  const updateSlotCap = (sid, val) => setSlots((prev) => prev.map((s) => s.id === sid ? { ...s, capacity: Number(val) } : s))

  /* ─── Calendar helpers ─── */
  const prevMonth = () => { if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11) } else setCalMonth((m) => m - 1) }
  const nextMonth = () => { if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0) } else setCalMonth((m) => m + 1) }

  const selectDay = (day) => {
    const key = toKey(calYear, calMonth, day)
    const existing = overrides[key] || { closed: false, capacity: '' }
    setSelectedDay({ key, day })
    setOverrideForm({ closed: existing.closed ?? false, capacity: existing.capacity ?? '' })
  }

  const saveOverride = () => {
    if (!selectedDay) return
    const cap = overrideForm.capacity === '' ? undefined : Number(overrideForm.capacity)
    if (cap !== undefined && cap <= 0) { toast.error('Sức chứa phải lớn hơn 0.'); return }
    if (!overrideForm.closed && cap === undefined) {
      // Remove override
      setOverrides((prev) => { const n = { ...prev }; delete n[selectedDay.key]; return n })
    } else {
      setOverrides((prev) => ({ ...prev, [selectedDay.key]: { closed: overrideForm.closed, capacity: cap } }))
    }
    setSelectedDay(null)
    toast.success('Đã cập nhật ngày đặc biệt.')
  }

  const removeOverride = (key) => {
    setOverrides((prev) => { const n = { ...prev }; delete n[key]; return n })
    if (selectedDay?.key === key) setSelectedDay(null)
  }

  /* ─── Save all ─── */
  const handleSave = async () => {
    const payload = {
      openDays,
      defaultCapacity,
      timeSlots: slots,
      specialDates: overrides,
    }
    setIsSaving(true)
    try {
      await partnerApi.saveSchedule(id, payload)
      toast.success('Đã lưu cấu hình lịch thành công!')
    } catch (err) {
      if (partnerApi.isNetworkError(err)) {
        toast.info('Chế độ demo (không có server) — thao tác được mô phỏng.')
      } else {
        toast.error(err.message)
      }
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) return (
    <PartnerLayout pageTitle="Schedule">
      <div className="flex items-center justify-center h-64">
        <span className="material-symbols-outlined animate-spin text-[40px] text-[#00474d]">progress_activity</span>
      </div>
    </PartnerLayout>
  )

  const daysCount = getDaysInMonth(calYear, calMonth)
  const firstOffset = getFirstDayOfMonth(calYear, calMonth)

  return (
    <PartnerLayout pageTitle="Schedule Config">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 -mt-2 mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/partner/attractions/${id}/tickets`)} className="p-2 rounded-full hover:bg-[#eceeef] transition-colors text-[#3f484a]">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <h2 className="text-2xl font-semibold text-[#191c1d]">Cấu hình lịch &amp; Sức chứa</h2>
            <p className="text-sm text-[#3f484a] mt-0.5 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">local_activity</span>{attractionName}
            </p>
          </div>
        </div>
        <button onClick={handleSave} disabled={isSaving} className="px-6 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-medium hover:bg-[#136870] transition-colors shadow-sm disabled:opacity-60 flex items-center gap-2 self-start sm:self-auto">
          {isSaving && <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>}
          <span className="material-symbols-outlined text-[18px]">save</span>
          Lưu cấu hình
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-[#f2f4f5] p-1 rounded-xl w-fit mb-6">
        {[{ key: 'slots', label: 'Khung giờ', icon: 'schedule' }, { key: 'calendar', label: 'Lịch đặc biệt', icon: 'calendar_month' }].map((t) => (
          <button
            key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === t.key ? 'bg-white text-[#00474d] shadow-sm' : 'text-[#3f484a] hover:text-[#191c1d]'}`}
          >
            <span className="material-symbols-outlined text-[18px]">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* ── TAB: Slots ── */}
      {activeTab === 'slots' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 flex flex-col gap-5">

            {/* Open days */}
            <SectionCard title="Ngày mở cửa" icon="event_available">
              <div className="grid grid-cols-7 gap-2">
                {DAYS.map((d, i) => (
                  <button
                    key={d} type="button"
                    onClick={() => setOpenDays((prev) => prev.map((v, idx) => idx === i ? !v : v))}
                    className={`flex flex-col items-center py-3 rounded-xl border-2 transition-all text-xs font-semibold ${openDays[i] ? 'border-[#00474d] bg-[#00474d]/5 text-[#00474d]' : 'border-[#e1e3e4] bg-white text-[#6f797a]'}`}
                  >
                    <span className="text-[10px] mb-0.5">{d}</span>
                    <span className={`material-symbols-outlined text-[16px] ${openDays[i] ? 'text-[#00474d]' : 'text-[#bec8ca]'}`}>{openDays[i] ? 'check_circle' : 'cancel'}</span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-[#6f797a]">Chọn các ngày trong tuần mà điểm tham quan mở cửa.</p>
            </SectionCard>

            {/* Default capacity */}
            <SectionCard title="Sức chứa mặc định mỗi ngày" icon="groups">
              <div className="flex items-center gap-4">
                <div className="flex-1 max-w-xs">
                  <input
                    type="number" min="1" value={defaultCapacity}
                    onChange={(e) => setDefaultCapacity(Number(e.target.value))}
                    className="w-full rounded-lg border border-[#bec8ca] focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm outline-none shadow-sm"
                  />
                </div>
                <p className="text-sm text-[#3f484a]">lượt khách / ngày</p>
              </div>
              <p className="mt-2 text-xs text-[#6f797a]">Áp dụng cho toàn bộ các ngày, trừ khi có cài đặt ghi đè trong lịch đặc biệt.</p>
            </SectionCard>

            {/* Time slots */}
            <SectionCard title="Cấu hình khung giờ" icon="schedule">
              <div className="flex flex-col gap-3">
                {slots.map((s) => (
                  <div key={s.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-opacity ${s.isActive ? 'border-[#e1e3e4] bg-white' : 'border-[#e1e3e4] bg-[#f7f8f9] opacity-60'}`}>
                    <span className="material-symbols-outlined text-[#00474d] text-[20px]">schedule</span>
                    <div className="flex-1 grid grid-cols-3 gap-3">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-[#6f797a]">Từ</span>
                        <span className="text-sm font-bold text-[#191c1d]">{s.start}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-[#6f797a]">Đến</span>
                        <span className="text-sm font-bold text-[#191c1d]">{s.end}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[14px] text-[#6f797a]">groups</span>
                        <input
                          type="number" min="1" value={s.capacity}
                          onChange={(e) => updateSlotCap(s.id, e.target.value)}
                          className="w-16 text-sm font-medium text-[#191c1d] border border-[#bec8ca] rounded px-1.5 py-0.5 outline-none focus:border-[#00474d]"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => toggleSlot(s.id)} className={`p-1.5 rounded-lg transition-colors ${s.isActive ? 'text-[#137333] hover:bg-[#E6F4EA]' : 'text-[#6f797a] hover:bg-[#f2f4f5]'}`}>
                        <span className="material-symbols-outlined text-[18px]">{s.isActive ? 'toggle_on' : 'toggle_off'}</span>
                      </button>
                      <button onClick={() => removeSlot(s.id)} className="p-1.5 rounded-lg text-[#3f484a] hover:text-[#ba1a1a] hover:bg-[#ffdad6] transition-colors">
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  </div>
                ))}

                {/* Add new slot */}
                <div className="mt-2 p-4 rounded-xl border-2 border-dashed border-[#bec8ca] bg-[#f7f8f9]">
                  <p className="text-xs font-semibold text-[#3f484a] mb-3 uppercase tracking-wider">Thêm khung giờ mới</p>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className="text-xs text-[#6f797a] mb-1 block">Giờ bắt đầu</label>
                      <input type="time" value={newSlot.start} onChange={(e) => setNewSlot((p) => ({ ...p, start: e.target.value }))} className="w-full rounded-lg border border-[#bec8ca] focus:border-[#00474d] px-3 py-2 text-sm outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-[#6f797a] mb-1 block">Giờ kết thúc</label>
                      <input type="time" value={newSlot.end} onChange={(e) => setNewSlot((p) => ({ ...p, end: e.target.value }))} className="w-full rounded-lg border border-[#bec8ca] focus:border-[#00474d] px-3 py-2 text-sm outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-[#6f797a] mb-1 block">Sức chứa</label>
                      <input type="number" min="1" placeholder="50" value={newSlot.capacity} onChange={(e) => setNewSlot((p) => ({ ...p, capacity: e.target.value }))} className="w-full rounded-lg border border-[#bec8ca] focus:border-[#00474d] px-3 py-2 text-sm outline-none" />
                    </div>
                  </div>
                  {slotError && <p className="text-xs text-[#ba1a1a] mb-2">{slotError}</p>}
                  <button onClick={addSlot} className="px-4 py-2 bg-[#00474d] text-white text-sm font-medium rounded-lg hover:bg-[#136870] transition-colors flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px]">add</span>Thêm khung giờ
                  </button>
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Summary sidebar */}
          <div>
            <div className="sticky top-24 bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5">
              <p className="text-xs font-semibold text-[#3f484a] uppercase tracking-wider mb-4">Tổng quan</p>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#6f797a]">Ngày mở cửa</span>
                  <span className="font-bold text-[#191c1d]">{openDays.filter(Boolean).length} / 7</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6f797a]">Sức chứa / ngày</span>
                  <span className="font-bold text-[#191c1d]">{defaultCapacity} lượt</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6f797a]">Tổng slots</span>
                  <span className="font-bold text-[#191c1d]">{slots.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#6f797a]">Slots hoạt động</span>
                  <span className="font-bold text-[#137333]">{slots.filter((s) => s.isActive).length}</span>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-[#f2f4f5]">
                <p className="text-xs text-[#6f797a]">Ngày mở:</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {DAY_LABELS.map((l, i) => openDays[i] && (
                    <span key={l} className="px-2 py-0.5 bg-[#00474d]/10 text-[#00474d] text-xs rounded-full font-medium">{l}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: Calendar ── */}
      {activeTab === 'calendar' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar widget */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5">
              {/* Month navigation */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={prevMonth} className="p-2 rounded-full hover:bg-[#f2f4f5] transition-colors">
                  <span className="material-symbols-outlined text-[20px]">chevron_left</span>
                </button>
                <h3 className="text-base font-bold text-[#191c1d]">{MONTHS[calMonth]} {calYear}</h3>
                <button onClick={nextMonth} className="p-2 rounded-full hover:bg-[#f2f4f5] transition-colors">
                  <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                </button>
              </div>

              {/* Day headers */}
              <div className="grid grid-cols-7 mb-2">
                {DAYS.map((d) => (
                  <div key={d} className="text-center text-xs font-semibold text-[#6f797a] py-2">{d}</div>
                ))}
              </div>

              {/* Calendar cells */}
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstOffset }).map((_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: daysCount }).map((_, i) => {
                  const day = i + 1
                  const key = toKey(calYear, calMonth, day)
                  const override = overrides[key]
                  const isToday = calYear === now.getFullYear() && calMonth === now.getMonth() && day === now.getDate()
                  const isSelected = selectedDay?.key === key
                  return (
                    <button
                      key={day} onClick={() => selectDay(day)}
                      className={`relative aspect-square flex flex-col items-center justify-center rounded-xl text-sm font-medium transition-all
                        ${isSelected ? 'bg-[#00474d] text-white' : override?.closed ? 'bg-[#ffdad6] text-[#ba1a1a]' : override ? 'bg-[#cfe5ff] text-[#003558]' : 'hover:bg-[#f2f4f5] text-[#191c1d]'}
                        ${isToday && !isSelected ? 'ring-2 ring-[#00474d]' : ''}
                      `}
                    >
                      {day}
                      {override && (
                        <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${override.closed ? 'bg-[#ba1a1a]' : 'bg-[#00474d]'} ${isSelected ? 'bg-white' : ''}`} />
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Legend */}
              <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-[#f2f4f5] text-xs text-[#3f484a]">
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#ffdad6]" />Ngày đóng cửa</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#cfe5ff]" />Sức chứa khác</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full ring-2 ring-[#00474d]" />Hôm nay</div>
              </div>
            </div>

            {/* Override list */}
            {Object.keys(overrides).length > 0 && (
              <div className="mt-4 bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5">
                <p className="text-sm font-semibold text-[#191c1d] mb-3">Ngày đặc biệt đã cấu hình</p>
                <div className="flex flex-col gap-2">
                  {Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-[#f7f8f9] border border-[#e1e3e4]">
                      <div className="flex items-center gap-3">
                        <span className={`material-symbols-outlined text-[18px] ${val.closed ? 'text-[#ba1a1a]' : 'text-[#00629d]'}`}>{val.closed ? 'event_busy' : 'event'}</span>
                        <div>
                          <p className="text-sm font-medium text-[#191c1d]">{key}</p>
                          <p className="text-xs text-[#6f797a]">{val.closed ? 'Đóng cửa' : `Sức chứa: ${val.capacity} lượt`}</p>
                        </div>
                      </div>
                      <button onClick={() => removeOverride(key)} className="p-1.5 rounded-lg text-[#3f484a] hover:text-[#ba1a1a] hover:bg-[#ffdad6] transition-colors">
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Day config panel */}
          <div>
            <div className="sticky top-24 bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5">
              {selectedDay ? (
                <>
                  <p className="text-xs font-semibold text-[#3f484a] uppercase tracking-wider mb-1">Ngày đã chọn</p>
                  <p className="text-lg font-bold text-[#191c1d] mb-4">{selectedDay.key}</p>

                  <div className="space-y-4">
                    <label className="flex items-center gap-3 p-3 rounded-xl border border-[#e1e3e4] cursor-pointer hover:bg-[#f7f8f9] transition-colors">
                      <input type="checkbox" checked={overrideForm.closed} onChange={(e) => setOverrideForm((p) => ({ ...p, closed: e.target.checked }))} className="w-4 h-4 accent-[#ba1a1a]" />
                      <div>
                        <p className="text-sm font-medium text-[#191c1d]">Đóng cửa ngày này</p>
                        <p className="text-xs text-[#6f797a]">Ngày này sẽ không nhận đặt chỗ.</p>
                      </div>
                    </label>

                    {!overrideForm.closed && (
                      <div>
                        <label className="block text-sm font-medium text-[#191c1d] mb-1.5">Sức chứa đặc biệt</label>
                        <input
                          type="number" min="1" placeholder={`Mặc định: ${defaultCapacity}`}
                          value={overrideForm.capacity}
                          onChange={(e) => setOverrideForm((p) => ({ ...p, capacity: e.target.value }))}
                          className="w-full rounded-lg border border-[#bec8ca] focus:border-[#00474d] focus:ring-1 focus:ring-[#00474d] px-4 py-3 text-sm outline-none shadow-sm"
                        />
                        <p className="text-xs text-[#6f797a] mt-1">Để trống để dùng sức chứa mặc định.</p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 mt-5">
                    <button onClick={() => setSelectedDay(null)} className="flex-1 py-2.5 rounded-lg border border-[#bec8ca] text-sm font-medium text-[#191c1d] hover:bg-[#f2f4f5] transition-colors">Hủy</button>
                    <button onClick={saveOverride} className="flex-1 py-2.5 rounded-lg bg-[#00474d] text-white text-sm font-medium hover:bg-[#136870] transition-colors">Lưu ngày</button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
                  <span className="material-symbols-outlined text-[40px] text-[#bec8ca]">touch_app</span>
                  <p className="text-sm font-medium text-[#3f484a]">Chọn một ngày trên lịch</p>
                  <p className="text-xs text-[#6f797a]">để cấu hình đóng cửa hoặc thay đổi sức chứa.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </PartnerLayout>
  )
}

function SectionCard({ title, icon, children }) {
  return (
    <div className="bg-white rounded-xl border border-[#e1e3e4] shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-[#f2f4f5]">
        <span className="material-symbols-outlined text-[20px] text-[#00474d]">{icon}</span>
        <h3 className="text-base font-semibold text-[#191c1d]">{title}</h3>
      </div>
      {children}
    </div>
  )
}

export default PartnerSchedulePage
