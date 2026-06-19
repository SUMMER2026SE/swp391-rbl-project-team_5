import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useAuth } from '../context/useAuth.js'
import { aiItinerary } from '../services/aiApi.js'
import {
  CATEGORY_OPTIONS,
  COMPANION_OPTIONS,
  PACE_OPTIONS,
  PRIORITY_OPTIONS,
  interestsToParam,
} from '../constants/travelCriteria.js'

function formatCurrency(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Liên hệ'
  }
  return `${new Intl.NumberFormat('vi-VN').format(amount)} VND`
}

function toTitleCase(str) {
  return str
    .trim()
    .split(' ')
    .map((w) => (w.charAt(0) || '').toUpperCase() + (w.slice(1) || '').toLowerCase())
    .join(' ')
}

const inputClass =
  'w-full rounded-2xl border border-[#cbd5db] bg-[#f8fafb] px-4 py-3 text-sm text-[#0f172a] outline-none transition focus:border-[#00474d] focus:ring-2 focus:ring-[#00474d]/20'

function AIItineraryPlanner() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [city, setCity] = useState('')
  const [days, setDays] = useState(3)
  const [adults, setAdults] = useState(2)
  const [children, setChildren] = useState(0)
  const [categories, setCategories] = useState([])
  const [pace, setPace] = useState('normal')
  const [priority, setPriority] = useState('balanced')
  const [companion, setCompanion] = useState('solo')
  const [budget, setBudget] = useState('')
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState(null)

  const handleClose = useCallback(() => {
    setIsOpen(false)
    setStep(1)
  }, [])

  const toggleCategory = useCallback((value) => {
    setCategories((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    )
  }, [])

  const handleCreatePlan = useCallback(async () => {
    if (!city.trim()) {
      toast.warning('Vui lòng nhập thành phố để tạo kế hoạch.')
      return
    }

    if (!days || days < 1 || days > 14) {
      toast.warning('Số ngày phải từ 1 đến 14.')
      return
    }

    const adultsValue = Number(adults) || 0
    const childrenValue = Number(children) || 0
    if (adultsValue + childrenValue < 1) {
      toast.warning('Vui lòng nhập số người (ít nhất 1 người).')
      return
    }

    setLoading(true)
    setPlan(null)

    try {
      const response = await aiItinerary({
        city: toTitleCase(city.trim()),
        days,
        adults: adultsValue,
        children: childrenValue,
        interests: interestsToParam(categories),
        budget: budget ? Number(budget) : undefined,
        pace,
        priority,
        companion,
      })

      setPlan(response.data || null)
      setStep(2)
    } catch (error) {
      console.error('AI itinerary error:', error)
      toast.error('Không thể tạo kế hoạch. Vui lòng thử lại sau.')
    } finally {
      setLoading(false)
    }
  }, [city, days, adults, children, categories, budget, pace, priority, companion])

  const handleCreateAgain = useCallback(() => {
    setPlan(null)
    setStep(1)
  }, [])

  const itineraryDays = useMemo(() => {
    if (!plan?.days) {
      return []
    }

    if (Array.isArray(plan.days)) {
      return plan.days
    }

    return []
  }, [plan])

  return (
    <div className="mb-8 rounded-3xl bg-white p-6 shadow-[0_18px_60px_rgba(0,71,77,0.06)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#00474d]">🗓️ Tạo kế hoạch tham quan</h2>
          <p className="text-sm text-[#475569]">
            Nhận gợi ý hành trình phù hợp với số ngày, số người, sở thích và phong cách đi của bạn.
          </p>
        </div>
        <button
          className="inline-flex items-center rounded-2xl bg-[#00474d] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-95"
          onClick={() => {
            if (!user) {
              toast.warning('Vui lòng đăng nhập để sử dụng tính năng tạo kế hoạch tham quan')
              navigate('/login')
              return
            }
            setIsOpen(true)
          }}
          type="button"
        >
          Tạo kế hoạch tham quan
        </button>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
          <div className="mx-auto max-w-3xl rounded-[32px] bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-[#00474d]">Kế hoạch tham quan AI</h2>
                <p className="mt-1 text-sm text-[#475569]">Điền thông tin và nhận lịch trình phù hợp ngay lập tức.</p>
              </div>
              <button
                aria-label="Đóng modal kế hoạch"
                className="rounded-full border border-[#cbd5db] bg-white px-3 py-2 text-[#334155] transition hover:bg-[#f8fafb]"
                onClick={handleClose}
                type="button"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {step === 1 && (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[#334155]">Thành phố</span>
                    <input
                      className={inputClass}
                      onChange={(event) => setCity(event.target.value)}
                      placeholder="Thành phố"
                      type="text"
                      value={city}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[#334155]">Số ngày</span>
                    <input
                      className={inputClass}
                      max="14"
                      min="1"
                      onChange={(event) => setDays(Number(event.target.value))}
                      placeholder="Số ngày"
                      type="number"
                      value={days}
                    />
                  </label>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[#334155]">Người lớn</span>
                    <input
                      className={inputClass}
                      min="0"
                      onChange={(event) => setAdults(Number(event.target.value))}
                      placeholder="Người lớn"
                      type="number"
                      value={adults}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[#334155]">Trẻ em</span>
                    <input
                      className={inputClass}
                      min="0"
                      onChange={(event) => setChildren(Number(event.target.value))}
                      placeholder="Trẻ em"
                      type="number"
                      value={children}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[#334155]">Ngân sách (VND)</span>
                    <input
                      className={inputClass}
                      onChange={(event) => setBudget(event.target.value)}
                      placeholder="Ví dụ: 2000000"
                      type="number"
                      value={budget}
                    />
                  </label>
                </div>

                <div>
                  <span className="mb-2 block text-sm font-semibold text-[#334155]">Loại hình ưa thích</span>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORY_OPTIONS.map((option) => {
                      const active = categories.includes(option.value)
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => toggleCategory(option.value)}
                          className={`rounded-full border px-4 py-2 text-sm font-medium transition active:scale-95 ${
                            active
                              ? 'border-[#00474d] bg-[#00474d] text-white'
                              : 'border-[#cbd5db] bg-white text-[#334155] hover:border-[#00474d]'
                          }`}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[#334155]">Nhịp độ chuyến đi</span>
                    <select className={inputClass} onChange={(event) => setPace(event.target.value)} value={pace}>
                      {PACE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} ({option.hint})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[#334155]">Ưu tiên gợi ý</span>
                    <select className={inputClass} onChange={(event) => setPriority(event.target.value)} value={priority}>
                      {PRIORITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[#334155]">Đi cùng ai</span>
                    <select className={inputClass} onChange={(event) => setCompanion(event.target.value)} value={companion}>
                      {COMPANION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button
                    className="rounded-2xl border border-[#cbd5db] bg-white px-5 py-3 text-sm font-semibold text-[#334155] transition hover:bg-[#f8fafb] active:scale-95"
                    onClick={handleClose}
                    type="button"
                  >
                    Hủy
                  </button>
                  <button
                    className="rounded-2xl bg-[#00474d] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-95"
                    disabled={loading}
                    onClick={handleCreatePlan}
                    type="button"
                  >
                    {loading ? 'Đang lên kế hoạch...' : 'Tạo kế hoạch'}
                  </button>
                </div>
              </div>
            )}

            {step === 2 && plan && (
              <div className="space-y-6">
                <div className="rounded-3xl border border-[#cbd5db] bg-[#f8fafb] p-6">
                  <h3 className="text-2xl font-bold text-[#00474d]">{plan.title || `Kế hoạch ${city}`}</h3>
                  <p className="mt-3 text-sm text-[#475569]">{plan.description || plan.summary || ''}</p>
                </div>

                <div className="space-y-4">
                  {itineraryDays.length > 0 ? (
                    itineraryDays.map((dayItem, index) => {
                      const activityList =
                        Array.isArray(dayItem.activities) && dayItem.activities.length > 0
                          ? dayItem.activities
                          : Array.isArray(dayItem.items)
                          ? dayItem.items
                          : []

                      return (
                        <div
                          className="rounded-3xl border border-[#e2e8f0] bg-white p-5 shadow-sm"
                          key={`${dayItem.day || dayItem.title || index}`}
                        >
                          <div className="mb-4 flex items-center justify-between gap-4">
                            <div>
                              <p className="text-sm font-semibold uppercase tracking-[0.15em] text-[#00629d]">
                                {dayItem.day ? `Ngày ${dayItem.day}` : `Ngày ${index + 1}`}
                              </p>
                              <h4 className="mt-2 text-lg font-bold text-[#0f172a]">
                                {dayItem.title || dayItem.theme || `Lộ trình ngày ${index + 1}`}
                              </h4>
                            </div>
                            {activityList.length === 0 && (
                              <span className="rounded-full bg-[#e2e8f0] px-3 py-1 text-xs font-semibold text-[#334155]">
                                Mở rộng thêm
                              </span>
                            )}
                          </div>

                          {activityList.length > 0 ? (
                            <div className="space-y-3">
                              {activityList.map((activity, activityIndex) => (
                                <div
                                  className="rounded-3xl border border-[#e2e8f0] bg-[#f8fafb] p-4"
                                  key={`${activity.title || activity.name || activityIndex}`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-semibold text-[#0f172a]">
                                        {activity.suggestedTime || activity.timeSlot || activity.time || activity.schedule || 'Thời gian linh hoạt'}
                                      </p>
                                      <p className="mt-1 text-base font-semibold text-[#00474d]">
                                        {activity.title || activity.name || activity.destination || 'Tham quan địa điểm'}
                                      </p>
                                      <p className="mt-1 text-xs text-gray-500">{activity.notes || activity.note}</p>
                                      {Number(activity.estimatedCost) > 0 && (
                                        <p className="mt-1 text-xs font-semibold text-[#00629d]">
                                          Vé cả nhóm: {formatCurrency(activity.estimatedCost)}
                                        </p>
                                      )}
                                    </div>
                                    {(activity.attractionId || activity.id) && (
                                      <button
                                        className="rounded-2xl bg-[#00474d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-95"
                                        onClick={() => navigate(`/attractions/${activity.attractionId || activity.id}`)}
                                        type="button"
                                      >
                                        Đặt vé
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-[#475569]">{dayItem.description || 'Nội dung chi tiết sẽ được AI tạo sau.'}</p>
                          )}

                          {Array.isArray(dayItem.alternatives) && dayItem.alternatives.length > 0 && (
                            <div className="mt-4 rounded-2xl border border-dashed border-[#cbd5db] bg-white p-4">
                              <p className="mb-2 text-sm font-semibold text-[#00629d]">🅱️ Kế hoạch B (nếu điểm chính đóng cửa/hết vé)</p>
                              <div className="space-y-2">
                                {dayItem.alternatives.map((alt, altIndex) => (
                                  <div
                                    className="flex flex-wrap items-center justify-between gap-2"
                                    key={`${alt.attractionId || alt.title || altIndex}`}
                                  >
                                    <div>
                                      <p className="text-sm font-semibold text-[#0f172a]">{alt.title || 'Địa điểm thay thế'}</p>
                                      <p className="text-xs text-gray-500">{alt.reason || 'Phương án thay thế gần khu vực.'}</p>
                                    </div>
                                    {(alt.attractionId || alt.id) && (
                                      <button
                                        className="rounded-xl border border-[#00474d] px-3 py-1.5 text-xs font-semibold text-[#00474d] transition hover:bg-[#00474d] hover:text-white active:scale-95"
                                        onClick={() => navigate(`/attractions/${alt.attractionId || alt.id}`)}
                                        type="button"
                                      >
                                        Xem
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })
                  ) : (
                    <div className="rounded-3xl border border-[#e2e8f0] bg-white p-5 text-sm text-[#475569]">
                      Không có dữ liệu lịch trình chi tiết.
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-2xl bg-[#f0fafa] p-4">
                  <p className="text-2xl font-bold text-[#00474d]">
                    {typeof plan.estimatedCost === 'object'
                      ? formatCurrency(plan.estimatedCost.total || 0)
                      : plan.estimatedCost || 'Chưa có thông tin'}
                  </p>
                  {typeof plan.estimatedCost === 'object' && plan.estimatedCost.perPerson && (
                    <p className="text-sm text-gray-500">
                      Mỗi người: {formatCurrency(plan.estimatedCost.perPerson)}
                    </p>
                  )}
                  {typeof plan.estimatedCost === 'object' && plan.estimatedCost.note && (
                    <p className="text-xs italic text-gray-400">{plan.estimatedCost.note}</p>
                  )}
                </div>

                {Array.isArray(plan.tips) && plan.tips.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-lg font-bold text-[#00474d]">💡 Mẹo du lịch</h4>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {plan.tips.map((tip, index) => (
                        <div key={index} className="flex gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-3">
                          <span className="mt-0.5 flex-shrink-0 text-green-500">✓</span>
                          <p className="text-sm text-[#475569]">{tip}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {plan.tips && typeof plan.tips === 'string' && (
                  <div className="space-y-3">
                    <h4 className="text-lg font-bold text-[#00474d]">💡 Mẹo du lịch</h4>
                    <div className="flex gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-3">
                      <span className="mt-0.5 flex-shrink-0 text-green-500">✓</span>
                      <p className="text-sm text-[#475569]">{plan.tips}</p>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button
                    className="rounded-2xl border border-[#cbd5db] bg-white px-5 py-3 text-sm font-semibold text-[#334155] transition hover:bg-[#f8fafb] active:scale-95"
                    onClick={handleCreateAgain}
                    type="button"
                  >
                    Tạo lại
                  </button>
                  <button
                    className="rounded-2xl bg-[#00474d] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-95"
                    onClick={handleClose}
                    type="button"
                  >
                    Đóng
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default AIItineraryPlanner
