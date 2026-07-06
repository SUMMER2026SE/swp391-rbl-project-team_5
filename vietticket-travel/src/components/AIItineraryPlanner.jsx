import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import AIItineraryDayWeather from './AIItineraryDayWeather.jsx'
import AIItineraryRouteMap from './AIItineraryRouteMap.jsx'
import { useAuth } from '../context/useAuth.js'
import {
  aiItinerary,
  deleteAiItinerary,
  getSavedAiItineraries,
  getSavedAiItineraryById,
  saveAiItinerary,
} from '../services/aiApi.js'
import {
  CATEGORY_OPTIONS,
  COMPANION_OPTIONS,
  PACE_OPTIONS,
  PRIORITY_OPTIONS,
  interestsToParam,
} from '../constants/travelCriteria.js'
import { buildAiBookingUrl } from '../utils/aiBookingPrefill.js'
import {
  buildItineraryQueueBookingUrl,
  createItineraryBookingQueue,
  saveItineraryBookingQueue,
} from '../utils/aiItineraryBookingQueue.js'
import {
  buildItineraryShareText,
  createItinerarySnapshot,
  getItineraryFeedback,
  loadItinerariesFromServer,
  loadSavedItineraries,
  removeItinerarySnapshot,
  saveItineraryFeedback,
  saveItinerarySnapshot,
  syncItineraryToServer,
} from '../utils/aiItineraryStorage.js'
import { getItineraryMapPoints } from '../utils/aiItineraryMap.js'

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

function todayInputValue() {
  const date = new Date()
  const timezoneOffset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10)
}

function formatSavedDate(value) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatDistanceKm(value) {
  const distance = Number(value)
  if (!Number.isFinite(distance) || distance <= 0) return ''
  return `${distance.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km`
}

function formatTravelMinutes(value) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes <= 0) return ''
  if (minutes < 60) return `${Math.round(minutes)} phút`

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = Math.round(minutes % 60)
  return remainingMinutes > 0 ? `${hours} giờ ${remainingMinutes} phút` : `${hours} giờ`
}

const inputClass =
  'w-full rounded-2xl border border-[#cbd5db] bg-[#f8fafb] px-4 py-3 text-sm text-[#0f172a] outline-none transition focus:border-[#00474d] focus:ring-2 focus:ring-[#00474d]/20'

function AIItineraryPlanner() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const ownerId = user?.id || user?.userId || ''
  const modalRef = useRef(null)
  const initialFocusRef = useRef(null)
  const previousFocusRef = useRef(null)
  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [city, setCity] = useState('')
  const [days, setDays] = useState(3)
  const [startDate, setStartDate] = useState(todayInputValue)
  const [adults, setAdults] = useState(2)
  const [children, setChildren] = useState(0)
  const [categories, setCategories] = useState([])
  const [pace, setPace] = useState('normal')
  const [priority, setPriority] = useState('balanced')
  const [companion, setCompanion] = useState('solo')
  const [budget, setBudget] = useState('')
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState(null)
  const [savedItineraries, setSavedItineraries] = useState(() => loadSavedItineraries())
  const [savedPlanId, setSavedPlanId] = useState('')
  const [feedbackValue, setFeedbackValue] = useState('')

  const handleClose = useCallback(() => {
    setIsOpen(false)
    setStep(1)
  }, [])

  useEffect(() => {
    if (!isOpen) return undefined

    previousFocusRef.current = document.activeElement

    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleClose()
        return
      }

      if (event.key !== 'Tab') return

      const dialog = modalRef.current
      if (!dialog) return

      const focusableElements = Array.from(dialog.querySelectorAll(focusableSelector))
        .filter((element) => element.offsetParent !== null || element === document.activeElement)

      if (focusableElements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus?.()
    }
  }, [handleClose, isOpen])

  useEffect(() => {
    if (!isOpen) return undefined

    const frameId = window.requestAnimationFrame(() => {
      if (step === 1) {
        initialFocusRef.current?.focus()
        return
      }
      modalRef.current?.focus()
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [isOpen, step])

  useEffect(() => {
    let active = true

    if (!ownerId) {
      Promise.resolve().then(() => {
        if (active) setSavedItineraries(loadSavedItineraries())
      })
      return undefined
    }

    loadItinerariesFromServer(getSavedAiItineraries, getSavedAiItineraryById)
      .then((merged) => {
        if (active) setSavedItineraries(merged)
      })

    return () => {
      active = false
    }
  }, [ownerId])

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

    if (!startDate) {
      toast.warning('Vui lòng chọn ngày bắt đầu để kiểm tra tình trạng còn vé.')
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
        startDate,
        adults: adultsValue,
        children: childrenValue,
        interests: interestsToParam(categories),
        budget: budget ? Number(budget) : undefined,
        pace,
        priority,
        companion,
      })

      const nextPlan = response.data
        ? { ...response.data, clientPlanId: `itinerary-${Date.now()}` }
        : null
      setPlan(nextPlan)
      setSavedPlanId('')
      setFeedbackValue('')
      setStep(2)
    } catch (error) {
      console.error('AI itinerary error:', error)
      toast.error('Không thể tạo kế hoạch. Vui lòng thử lại sau.')
    } finally {
      setLoading(false)
    }
  }, [city, days, startDate, adults, children, categories, budget, pace, priority, companion])

  const handleCreateAgain = useCallback(() => {
    setPlan(null)
    setSavedPlanId('')
    setFeedbackValue('')
    setStep(1)
  }, [])

  const currentCriteria = useMemo(
    () => ({
      adults,
      budget: budget ? Number(budget) : undefined,
      children,
      city: toTitleCase(city.trim()),
      companion,
      days,
      interests: interestsToParam(categories),
      ownerId,
      pace,
      priority,
      startDate,
    }),
    [adults, budget, children, city, companion, days, categories, ownerId, pace, priority, startDate],
  )

  const handleSavePlan = useCallback(async () => {
    if (!plan) return

    try {
      const snapshot = createItinerarySnapshot(plan, currentCriteria)
      const saved = saveItinerarySnapshot(snapshot)
      if (saved) {
        setSavedPlanId(saved.id)
        setSavedItineraries(loadSavedItineraries())
        if (ownerId) {
          const synced = await syncItineraryToServer(saved, saveAiItinerary)
          if (synced) {
            const merged = await loadItinerariesFromServer(getSavedAiItineraries, getSavedAiItineraryById)
            setSavedItineraries(merged)
            toast.success('Đã lưu lịch trình vào tài khoản.')
            return
          }
          toast.warning('Đã lưu trên thiết bị này. Đồng bộ tài khoản sẽ thử lại khi kết nối ổn định.')
          return
        }
        toast.success('Đã lưu lịch trình trên thiết bị này.')
      } else {
        toast.error('Không thể lưu lịch trình lúc này.')
      }
    } catch (error) {
      console.error('Save itinerary error:', error)
      toast.error('Không thể lưu lịch trình lúc này.')
    }
  }, [currentCriteria, ownerId, plan])

  const handleOpenSavedPlan = useCallback((snapshot) => {
    if (!snapshot?.plan) {
      toast.error('Không thể mở lịch trình đã lưu.')
      return
    }

    const restoredPlan = {
      ...snapshot.plan,
      clientPlanId: snapshot.id,
    }
    setPlan(restoredPlan)
    setSavedPlanId(snapshot.id)
    setFeedbackValue(getItineraryFeedback(snapshot.id))
    setStep(2)
    setIsOpen(true)
  }, [])

  const handleRemoveSavedPlan = useCallback(async (planId) => {
    const next = removeItinerarySnapshot(planId)
    setSavedItineraries(next)
    if (savedPlanId === planId) {
      setSavedPlanId('')
    }
    if (ownerId) {
      try {
        await deleteAiItinerary(planId)
      } catch (error) {
        if (error?.status !== 404) {
          toast.warning('Đã xóa trên thiết bị này, nhưng chưa xóa được bản lưu trên tài khoản.')
          return
        }
      }
    }
    toast.success('Đã xóa lịch trình đã lưu.')
  }, [ownerId, savedPlanId])

  const handleSharePlan = useCallback(async () => {
    if (!plan) return

    const text = buildItineraryShareText(plan)
    try {
      if (navigator.share) {
        await navigator.share({
          title: plan.title || 'Lịch trình VietTicket Travel',
          text,
        })
        return
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        toast.success('Đã sao chép lịch trình để chia sẻ.')
        return
      }

      window.prompt('Sao chép lịch trình:', text)
    } catch (error) {
      if (error?.name !== 'AbortError') {
        toast.error('Không thể chia sẻ lịch trình lúc này.')
      }
    }
  }, [plan])

  const handleFeedback = useCallback((value) => {
    if (!plan?.clientPlanId) return

    const saved = saveItineraryFeedback(plan.clientPlanId, value)
    if (saved) {
      setFeedbackValue(getItineraryFeedback(plan.clientPlanId))
      toast.success(value === 'up' ? 'Cảm ơn phản hồi của bạn.' : 'Đã ghi nhận góp ý để cải thiện gợi ý.')
    }
  }, [plan])

  const itineraryDays = useMemo(() => {
    if (!plan?.days) {
      return []
    }

    if (Array.isArray(plan.days)) {
      return plan.days
    }

    return []
  }, [plan])

  const bookingQueue = useMemo(
    () => createItineraryBookingQueue(plan, { fallbackStartDate: startDate, ownerId }),
    [ownerId, plan, startDate],
  )
  const bookableQueueItems = bookingQueue?.items || []
  const visibleSavedItineraries = useMemo(
    () =>
      savedItineraries.filter((item) => !item.ownerId || !ownerId || item.ownerId === ownerId),
    [ownerId, savedItineraries],
  )

  const handleStartPlanBooking = useCallback(() => {
    if (!bookingQueue || bookableQueueItems.length === 0) {
      toast.warning('Lịch trình này chưa có dòng vé phù hợp để đặt tự động.')
      return
    }

    const savedQueue = saveItineraryBookingQueue(bookingQueue)
    const firstUrl = buildItineraryQueueBookingUrl(savedQueue, savedQueue?.items?.[0])

    if (!savedQueue || !firstUrl) {
      toast.error('Không thể tạo danh sách đặt vé từ lịch trình lúc này.')
      return
    }

    toast.success(`Đã tạo danh sách ${savedQueue.items.length} lượt đặt vé từ lịch trình.`)
    navigate(firstUrl)
  }, [bookableQueueItems.length, bookingQueue, navigate])

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

      {visibleSavedItineraries.length > 0 && (
        <div className="mt-5 rounded-3xl border border-[#e2e8f0] bg-[#f8fafb] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-[#00474d]">Lịch trình đã lưu</h3>
              <p className="text-xs font-semibold text-[#64748b]">
                Lưu trên thiết bị này, tối đa 20 lịch trình gần nhất.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[#00474d]">
              {visibleSavedItineraries.length} bản lưu
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {visibleSavedItineraries.slice(0, 4).map((item) => {
              const criteria = item.criteria || {}
              const meta = [
                criteria.city,
                criteria.startDate,
                criteria.days ? `${criteria.days} ngày` : '',
                formatSavedDate(item.createdAt),
              ]
                .filter(Boolean)
                .join(' - ')

              return (
                <div
                  className="rounded-2xl border border-[#dbe4e8] bg-white p-4 shadow-sm"
                  key={item.id}
                >
                  <p className="line-clamp-2 text-sm font-bold text-[#0f172a]">
                    {item.title || item.plan?.title || 'Lịch trình AI'}
                  </p>
                  {meta && <p className="mt-1 text-xs text-[#64748b]">{meta}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="rounded-xl bg-[#00474d] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#00629d] active:scale-95"
                      onClick={() => handleOpenSavedPlan(item)}
                      type="button"
                    >
                      Mở
                    </button>
                    <button
                      className="rounded-xl border border-[#cbd5db] bg-white px-3 py-2 text-xs font-bold text-[#334155] transition hover:border-[#ef4444] hover:text-[#ef4444] active:scale-95"
                      onClick={() => handleRemoveSavedPlan(item.id)}
                      type="button"
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {visibleSavedItineraries.length > 4 && (
            <p className="mt-3 text-xs font-semibold text-[#64748b]">
              Hiển thị 4 lịch trình mới nhất. Xóa bớt bản cũ để quản lý danh sách gọn hơn.
            </p>
          )}
        </div>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
          <div
            aria-describedby="ai-itinerary-dialog-description"
            aria-labelledby="ai-itinerary-dialog-title"
            aria-modal="true"
            className="mx-auto max-w-3xl rounded-[32px] bg-white p-6 shadow-2xl outline-none"
            ref={modalRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2
                  className="text-2xl font-bold text-[#00474d]"
                  id="ai-itinerary-dialog-title"
                >
                  Kế hoạch tham quan AI
                </h2>
                <p
                  className="mt-1 text-sm text-[#475569]"
                  id="ai-itinerary-dialog-description"
                >
                  Điền thông tin và nhận lịch trình phù hợp ngay lập tức.
                </p>
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
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[#334155]">Thành phố</span>
                    <input
                      className={inputClass}
                      onChange={(event) => setCity(event.target.value)}
                      placeholder="Thành phố"
                      ref={initialFocusRef}
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
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-[#334155]">Ngày bắt đầu</span>
                    <input
                      className={inputClass}
                      min={todayInputValue()}
                      onChange={(event) => setStartDate(event.target.value)}
                      type="date"
                      value={startDate}
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
                  <div className="mt-5 flex flex-wrap gap-2">
                    {bookableQueueItems.length > 0 && (
                      <button
                        className="inline-flex items-center gap-2 rounded-2xl bg-[#00474d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-95"
                        onClick={handleStartPlanBooking}
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                          shopping_cart_checkout
                        </span>
                        Đặt theo lịch trình ({bookableQueueItems.length})
                      </button>
                    )}
                    <button
                      className="inline-flex items-center gap-2 rounded-2xl border border-[#00474d] bg-white px-4 py-2 text-sm font-semibold text-[#00474d] transition hover:bg-[#e8f7f8] active:scale-95"
                      onClick={handleSavePlan}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                        {savedPlanId === plan.clientPlanId ? 'bookmark_added' : 'bookmark'}
                      </span>
                      {savedPlanId === plan.clientPlanId ? 'Đã lưu' : 'Lưu lịch trình'}
                    </button>
                    <button
                      className="inline-flex items-center gap-2 rounded-2xl border border-[#cbd5db] bg-white px-4 py-2 text-sm font-semibold text-[#334155] transition hover:bg-[#f8fafb] active:scale-95"
                      onClick={handleSharePlan}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">share</span>
                      Chia sẻ
                    </button>
                    <button
                      aria-pressed={feedbackValue === 'up'}
                      className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition active:scale-95 ${
                        feedbackValue === 'up'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-[#cbd5db] bg-white text-[#334155] hover:bg-[#f8fafb]'
                      }`}
                      onClick={() => handleFeedback('up')}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">thumb_up</span>
                      Hữu ích
                    </button>
                    <button
                      aria-pressed={feedbackValue === 'down'}
                      className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold transition active:scale-95 ${
                        feedbackValue === 'down'
                          ? 'border-amber-500 bg-amber-50 text-amber-700'
                          : 'border-[#cbd5db] bg-white text-[#334155] hover:bg-[#f8fafb]'
                      }`}
                      onClick={() => handleFeedback('down')}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">thumb_down</span>
                      Cần cải thiện
                    </button>
                  </div>
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
                      const routeSegments = Array.isArray(dayItem.routeSegments)
                        ? dayItem.routeSegments
                        : []
                      const routeSummary = dayItem.routeSummary || {}
                      const routePoints = getItineraryMapPoints(activityList)
                      const weatherActivity = activityList.find((activity) =>
                        getItineraryMapPoints([activity]).length > 0,
                      )
                      const routeDistance = formatDistanceKm(routeSummary.totalDistanceKm)
                      const routeDuration = formatTravelMinutes(routeSummary.totalTravelMinutes)

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

                          {(routePoints.length > 0 || routeSegments.length > 0 || weatherActivity) && (
                            <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
                              {routePoints.length > 0 && (
                                <AIItineraryRouteMap activities={activityList} />
                              )}
                              <div className="space-y-3">
                                {(routeDistance || routeDuration || routeSegments.length > 0 || routeSummary.note) && (
                                  <div className="rounded-2xl border border-[#dbe4e8] bg-[#f8fafb] p-4">
                                    <div className="mb-2 flex items-center gap-2">
                                      <span
                                        className="material-symbols-outlined text-[20px] text-[#006068]"
                                        aria-hidden="true"
                                      >
                                        route
                                      </span>
                                      <p className="text-sm font-bold text-[#00474d]">Tuyến di chuyển</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-[#475569]">
                                      {routeDistance && (
                                        <p>
                                          Quãng đường: <span className="text-[#0f172a]">{routeDistance}</span>
                                        </p>
                                      )}
                                      {routeDuration && (
                                        <p>
                                          Thời gian: <span className="text-[#0f172a]">{routeDuration}</span>
                                        </p>
                                      )}
                                    </div>
                                    {routeSegments.length > 0 && (
                                      <div className="mt-3 space-y-1">
                                        {routeSegments.slice(0, 3).map((segment, segmentIndex) => (
                                          <p
                                            className="text-xs text-[#64748b]"
                                            key={`${segment.fromAttractionId}-${segment.toAttractionId}-${segmentIndex}`}
                                          >
                                            {segment.fromTitle} → {segment.toTitle}
                                            {segment.distanceKm
                                              ? ` · ${formatDistanceKm(segment.distanceKm)}`
                                              : ''}
                                            {segment.estimatedTravelMinutes
                                              ? ` · ${formatTravelMinutes(segment.estimatedTravelMinutes)}`
                                              : ''}
                                          </p>
                                        ))}
                                      </div>
                                    )}
                                    {routeSummary.note && (
                                      <p className="mt-3 text-xs italic text-[#64748b]">
                                        {routeSummary.note}
                                      </p>
                                    )}
                                  </div>
                                )}
                                {weatherActivity && (
                                  <AIItineraryDayWeather
                                    activity={weatherActivity}
                                    visitDate={dayItem.visitDate || plan.startDate || startDate}
                                  />
                                )}
                              </div>
                            </div>
                          )}

                          {activityList.length > 0 ? (
                            <div className="space-y-3">
                              {activityList.map((activity, activityIndex) => {
                                const attractionId = activity.attractionId || activity.id
                                const ticketItems = Array.isArray(activity.ticketItems)
                                  ? activity.ticketItems
                                  : []
                                const fallbackBookingDate =
                                  activity.visitDate || dayItem.visitDate || plan.startDate || startDate
                                const bookableTicketLines = ticketItems.filter((ticket) => ticket?.ticketId)

                                return (
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
                                      {attractionId && (
                                        <div className="flex min-w-[150px] flex-col items-stretch gap-2">
                                          {bookableTicketLines.length > 0 ? (
                                            bookableTicketLines.map((ticket, ticketIndex) => {
                                              const ticketName =
                                                ticket.ticketName || ticket.name || ticket.title || 'vé'
                                              const quantity = Number(ticket.quantity) || 1
                                              const bookingUrl = buildAiBookingUrl({
                                                attractionId,
                                                fallbackDate: fallbackBookingDate,
                                                ticketLine: ticket,
                                              })

                                              return (
                                                <button
                                                  className="rounded-2xl bg-[#00474d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-95"
                                                  key={`${ticket.ticketId || ticketName}-${ticketIndex}`}
                                                  onClick={() => navigate(bookingUrl || `/attractions/${attractionId}`)}
                                                  type="button"
                                                >
                                                  Đặt {ticketName} ({quantity} vé)
                                                </button>
                                              )
                                            })
                                          ) : (
                                            <button
                                              className="rounded-2xl bg-[#00474d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-95"
                                              onClick={() => navigate(`/attractions/${attractionId}`)}
                                              type="button"
                                            >
                                              Xem vé
                                            </button>
                                          )}
                                          {bookableTicketLines.length > 1 && (
                                            <p className="text-center text-[11px] font-semibold text-[#64748b]">
                                              Đặt riêng từng loại vé để giữ đúng số lượng.
                                            </p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
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
