import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import Seo from '../components/Seo.jsx'
import { createPartyRoom, listPartyRooms } from '../services/partyApi.js'
import {
  getVietnamDateInput,
  getVietnamTomorrowInput,
} from '../utils/businessDate.js'

const paceOptions = [
  { value: 'relaxed', label: 'Thư giãn', hint: 'Khoảng 1 điểm/ngày' },
  { value: 'normal', label: 'Vừa phải', hint: 'Khoảng 2 điểm/ngày' },
  { value: 'packed', label: 'Khám phá nhiều', hint: 'Khoảng 3 điểm/ngày' },
]

const statusMeta = {
  OPEN: { label: 'Đang bình chọn', className: 'bg-emerald-50 text-emerald-700' },
  FINALIZED: { label: 'Đã chốt', className: 'bg-sky-50 text-sky-700' },
  CLOSED: { label: 'Đã đóng', className: 'bg-slate-100 text-slate-600' },
  EXPIRED: { label: 'Hết hạn', className: 'bg-slate-100 text-slate-600' },
}

const formatCurrency = (value) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))

const formatDate = (value) => {
  if (!value) return ''
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

function PartyRoomsPage() {
  const navigate = useNavigate()
  const [rooms, setRooms] = useState([])
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    title: '',
    city: 'Đà Nẵng',
    startDate: getVietnamTomorrowInput(),
    dayCount: 2,
    adults: 3,
    children: 0,
    totalBudget: 3000000,
    pace: 'normal',
    maxMembers: 6,
  })

  const loadRooms = useCallback(async () => {
    setLoadingRooms(true)
    try {
      const response = await listPartyRooms()
      setRooms(Array.isArray(response?.data) ? response.data : [])
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoadingRooms(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRooms(), 0)
    return () => window.clearTimeout(timer)
  }, [loadRooms])

  const activeRooms = useMemo(
    () => rooms.filter((room) => ['OPEN', 'FINALIZED'].includes(room.status)),
    [rooms],
  )

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((current) => ({
      ...current,
      [name]: ['dayCount', 'adults', 'children', 'totalBudget', 'maxMembers'].includes(name)
        ? Number(value)
        : value,
    }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (creating) return
    setCreating(true)
    try {
      const response = await createPartyRoom(form)
      const room = response?.data?.room
      const inviteToken = response?.data?.inviteToken
      if (!room?.id) throw new Error('Máy chủ chưa trả về phòng vừa tạo.')
      toast.success('Đã mở phòng PartySync.')
      navigate(`/party/${room.id}`, { state: { inviteToken } })
    } catch (error) {
      toast.error(error.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <Seo
        title="PartySync | Lập kế hoạch du lịch nhóm"
        description="Mời bạn đồng hành, bình chọn realtime và chốt lịch trình nhóm từ dữ liệu vé thật trên VietTicket."
      />
      <Header activeLink="PartySync" />
      <main className="min-h-screen bg-[#f5f8f8] pb-20">
        <section className="relative overflow-hidden bg-[#043f44] px-5 py-16 text-white">
          <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[#23d5c3]/20 blur-3xl" />
          <div className="absolute -bottom-32 left-1/4 h-72 w-72 rounded-full bg-amber-300/15 blur-3xl" />
          <div className="relative mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-extrabold uppercase tracking-[0.18em]">
                <span className="material-symbols-outlined text-lg">groups</span>
                VietTicket PartySync
              </span>
              <h1 className="mt-6 max-w-3xl text-4xl font-black leading-tight text-white md:text-6xl">
                Một mã QR. Cả nhóm cùng chọn. Một lịch trình ai cũng muốn đi.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-white/75 md:text-lg">
                Mời bạn đồng hành tham gia không cần tài khoản, bình chọn trên điện thoại
                và chốt phương án dựa trên ngân sách, tồn vé và lịch vận hành thật.
              </p>
              <div className="mt-8 flex flex-wrap gap-5 text-sm font-bold text-white/85">
                {[
                  ['qr_code_2', 'Quét để tham gia'],
                  ['bolt', 'Cập nhật realtime'],
                  ['verified', 'Kiểm tra vé thật'],
                ].map(([icon, label]) => (
                  <span className="flex items-center gap-2" key={label}>
                    <span className="material-symbols-outlined text-[#7ff6e8]">{icon}</span>
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/15 bg-white/10 p-5 shadow-2xl backdrop-blur">
              <div className="rounded-2xl bg-white p-5 text-[#173234]">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#008b84]">
                  Phòng đang hoạt động
                </p>
                <div className="mt-3 flex items-end gap-3">
                  <span className="text-5xl font-black text-[#043f44]">{activeRooms.length}</span>
                  <span className="pb-1 text-sm font-semibold text-slate-500">
                    chuyến của bạn
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {['Tạo phòng', 'Cùng vote', 'Chốt lịch'].map((label, index) => (
                    <div className="rounded-xl bg-[#eef9f7] px-2 py-3 text-center" key={label}>
                      <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-[#006b68] text-xs font-black text-white">
                        {index + 1}
                      </div>
                      <p className="mt-2 text-xs font-bold">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 lg:grid-cols-[0.92fr_1.08fr]">
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#d8f5f1] text-[#006b68]">
                <span className="material-symbols-outlined">add_location_alt</span>
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#008b84]">
                  Bắt đầu chuyến mới
                </p>
                <h2 className="mt-1 text-2xl font-black">Tạo phòng bình chọn</h2>
              </div>
            </div>

            <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
              <label className="block">
                <span className="text-sm font-bold text-slate-700">Tên chuyến đi</span>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-[#008b84] focus:ring-4 focus:ring-[#008b84]/10"
                  name="title"
                  onChange={handleChange}
                  placeholder="Ví dụ: Đà Nẵng cùng hội bạn"
                  value={form.title}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-bold text-slate-700">Thành phố</span>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-[#008b84] focus:ring-4 focus:ring-[#008b84]/10"
                    name="city"
                    onChange={handleChange}
                    required
                    value={form.city}
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-bold text-slate-700">Ngày bắt đầu</span>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-[#008b84] focus:ring-4 focus:ring-[#008b84]/10"
                    max={getVietnamDateInput(365)}
                    min={getVietnamTomorrowInput()}
                    name="startDate"
                    onChange={handleChange}
                    required
                    type="date"
                    value={form.startDate}
                  />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  ['dayCount', 'Số ngày', 1, 5],
                  ['adults', 'Người lớn', 0, 20],
                  ['children', 'Trẻ em', 0, 20],
                ].map(([name, label, min, max]) => (
                  <label className="block" key={name}>
                    <span className="text-sm font-bold text-slate-700">{label}</span>
                    <input
                      className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-[#008b84]"
                      max={max}
                      min={min}
                      name={name}
                      onChange={handleChange}
                      type="number"
                      value={form[name]}
                    />
                  </label>
                ))}
              </div>

              <label className="block">
                <span className="flex items-center justify-between gap-3 text-sm font-bold text-slate-700">
                  Ngân sách vé của cả nhóm
                  <span className="text-[#006b68]">{formatCurrency(form.totalBudget)}</span>
                </span>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-[#008b84]"
                  min="100000"
                  name="totalBudget"
                  onChange={handleChange}
                  step="50000"
                  type="number"
                  value={form.totalBudget}
                />
                <span className="mt-2 block text-xs text-slate-500">
                  Chỉ tính vé tham quan, chưa gồm ăn uống và di chuyển.
                </span>
              </label>

              <fieldset>
                <legend className="text-sm font-bold text-slate-700">Nhịp độ</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {paceOptions.map((option) => (
                    <label
                      className={`cursor-pointer rounded-xl border p-3 transition ${
                        form.pace === option.value
                          ? 'border-[#008b84] bg-[#eef9f7] ring-2 ring-[#008b84]/10'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                      key={option.value}
                    >
                      <input
                        checked={form.pace === option.value}
                        className="sr-only"
                        name="pace"
                        onChange={handleChange}
                        type="radio"
                        value={option.value}
                      />
                      <span className="block text-sm font-extrabold">{option.label}</span>
                      <span className="mt-1 block text-[11px] text-slate-500">{option.hint}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <button
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006b68] px-5 py-4 font-extrabold text-white shadow-lg shadow-[#006b68]/20 transition hover:bg-[#005b59] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={creating}
                type="submit"
              >
                <span className={`material-symbols-outlined ${creating ? 'animate-spin' : ''}`}>
                  {creating ? 'progress_activity' : 'qr_code_2'}
                </span>
                {creating ? 'Đang chuẩn bị địa điểm...' : 'Tạo phòng & mã mời'}
              </button>
            </form>
          </section>

          <section>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#008b84]">
                  Phòng của bạn
                </p>
                <h2 className="mt-1 text-2xl font-black">Tiếp tục lập kế hoạch</h2>
              </div>
              <button
                className="rounded-full border border-slate-300 bg-white p-2 text-slate-600 hover:bg-slate-50"
                onClick={() => void loadRooms()}
                type="button"
              >
                <span className="material-symbols-outlined">refresh</span>
                <span className="sr-only">Tải lại danh sách</span>
              </button>
            </div>

            <div className="mt-6 space-y-4">
              {loadingRooms ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center font-semibold text-slate-500">
                  Đang tải các phòng…
                </div>
              ) : rooms.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-10 text-center">
                  <span className="material-symbols-outlined text-5xl text-slate-300">diversity_3</span>
                  <h3 className="mt-3 font-black">Chưa có phòng nào</h3>
                  <p className="mt-2 text-sm text-slate-500">
                    Tạo chuyến đầu tiên để mời bạn bè cùng lựa chọn.
                  </p>
                </div>
              ) : (
                rooms.map((room) => {
                  const status = statusMeta[room.status] || statusMeta.CLOSED
                  return (
                    <Link
                      className="group block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#65bdb7] hover:shadow-md"
                      key={room.id}
                      to={`/party/${room.id}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-black">{room.title}</h3>
                            <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${status.className}`}>
                              {status.label}
                            </span>
                          </div>
                          <p className="mt-2 flex items-center gap-1 text-sm font-semibold text-slate-500">
                            <span className="material-symbols-outlined text-lg">location_on</span>
                            {room.city} · {formatDate(room.startDate)} · {room.dayCount} ngày
                          </p>
                        </div>
                        <span className="material-symbols-outlined text-[#008b84] transition group-hover:translate-x-1">
                          arrow_forward
                        </span>
                      </div>
                      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-sm">
                        <div>
                          <span className="block text-xs text-slate-400">Thành viên</span>
                          <strong>{room.memberCount}/{room.maxMembers || 10}</strong>
                        </div>
                        <div>
                          <span className="block text-xs text-slate-400">Ngân sách</span>
                          <strong>{formatCurrency(room.totalBudget)}</strong>
                        </div>
                        <div>
                          <span className="block text-xs text-slate-400">Địa điểm</span>
                          <strong>{room.candidateCount}</strong>
                        </div>
                      </div>
                    </Link>
                  )
                })
              )}
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  )
}

export default PartyRoomsPage
