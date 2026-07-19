import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { aiRecommend } from '../services/aiApi.js'
import {
  CATEGORY_OPTIONS,
  COMPANION_OPTIONS,
  PRIORITY_OPTIONS,
  interestsToParam,
} from '../constants/travelCriteria.js'
import { AI_BOOKING_SOURCE, buildAiBookingUrl } from '../utils/aiBookingPrefill.js'

function formatCurrency(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Liên hệ'
  }
  return `${new Intl.NumberFormat('vi-VN').format(amount)} VND`
}

function refundPolicyLabel(ticket) {
  if (ticket?.refundPolicy === 'NON_REFUNDABLE') return 'Không hoàn tiền'
  if (ticket?.refundPolicy === 'FREE_CANCELLATION') {
    return ticket.refundCutoffHours
      ? `Hủy miễn phí trước ${ticket.refundCutoffHours} giờ`
      : 'Hủy miễn phí theo hạn của vé'
  }
  if (ticket?.refundPolicy === 'REFUND_WITH_FEE') {
    const feeRate = Number(ticket.refundFeeRate)
    const feeText = Number.isFinite(feeRate) && feeRate > 0
      ? ` ${Math.round(feeRate * 100)}%`
      : ''
    return ticket.refundCutoffHours
      ? `Phí hủy${feeText}, trước ${ticket.refundCutoffHours} giờ`
      : `Phí hủy${feeText} theo điều kiện vé`
  }
  return ''
}

function todayInputValue() {
  const date = new Date()
  const timezoneOffset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10)
}

function formatCheckedAt(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const inputClass =
  'w-full rounded-2xl border border-[#cbd5db] bg-[#f8fafb] px-4 py-3 text-sm text-[#0f172a] outline-none transition focus:border-[#00474d] focus:ring-2 focus:ring-[#00474d]/20'

function buildAiDetailUrl(attractionId, criteria) {
  if (!attractionId) return ''

  const params = new URLSearchParams({ source: AI_BOOKING_SOURCE })
  if (criteria.visitDate) params.set('date', criteria.visitDate)
  const totalPeople = (Number(criteria.adults) || 0) + (Number(criteria.children) || 0)
  if (totalPeople > 0) params.set('qty', String(totalPeople))
  if (Number(criteria.adults) > 0) params.set('adults', String(Number(criteria.adults)))
  if (Number(criteria.children) > 0) params.set('children', String(Number(criteria.children)))
  if (criteria.budget) params.set('budget', String(criteria.budget))
  if (criteria.priority) params.set('priority', criteria.priority)
  if (criteria.companion) params.set('companion', criteria.companion)
  if (criteria.interests) params.set('interests', criteria.interests)

  return `/attractions/${attractionId}?${params.toString()}`
}

function AIRecommendSection() {
  const navigate = useNavigate()
  const [budget, setBudget] = useState('')
  const [visitDate, setVisitDate] = useState(todayInputValue)
  const [adults, setAdults] = useState(2)
  const [children, setChildren] = useState(0)
  const [city, setCity] = useState('')
  const [categories, setCategories] = useState([])
  const [priority, setPriority] = useState('balanced')
  const [companion, setCompanion] = useState('couple')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  const toggleCategory = useCallback((value) => {
    setCategories((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value],
    )
  }, [])

  const handleSubmit = useCallback(
    async (event) => {
      event.preventDefault()
      const budgetValue = Number(budget)
      const adultsValue = Number(adults) || 0
      const childrenValue = Number(children) || 0

      if (!budgetValue || budgetValue <= 0) {
        toast.warning('Vui lòng nhập ngân sách hợp lệ.')
        return
      }
      if (!visitDate) {
        toast.warning('Vui lòng chọn ngày tham quan để kiểm tra tình trạng còn vé.')
        return
      }
      if (adultsValue + childrenValue <= 0) {
        toast.warning('Vui lòng nhập số người (ít nhất 1 người).')
        return
      }

      setLoading(true)
      setResult(null)

      try {
        const response = await aiRecommend({
          budget: budgetValue,
          visitDate,
          adults: adultsValue,
          children: childrenValue,
          city: city.trim() || undefined,
          interests: interestsToParam(categories),
          priority,
          companion,
        })
        setResult(response.data || null)
      } catch (error) {
        console.error('AI recommend error:', error)
        toast.error('Không thể tải gợi ý. Vui lòng thử lại sau.')
      } finally {
        setLoading(false)
      }
    },
    [budget, visitDate, adults, children, city, categories, priority, companion],
  )

  const ticketPackages = Array.isArray(result?.ticketPackages)
    ? result.ticketPackages
    : Array.isArray(result?.combos)
      ? result.combos
      : []
  const aiDetailCriteria = {
    adults,
    budget,
    children,
    companion,
    interests: interestsToParam(categories),
    priority,
    visitDate,
  }

  return (
    <section className="my-12 rounded-[28px] border border-[#e2e8f0] bg-white p-6 shadow-[0_18px_60px_rgba(0,71,77,0.06)]">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#00474d]">✨ Gợi ý địa điểm theo tiêu chí của bạn</h2>
          <p className="mt-2 max-w-2xl text-sm text-[#475569]">
            Cho chúng tôi biết ngân sách, số người, sở thích và phong cách đi — chúng tôi sẽ đề xuất địa điểm & gói vé hợp gu nhất.
          </p>
        </div>
      </div>

      <form className="mb-8 space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[#334155]">Ngân sách (VND)</span>
            <input
              className={inputClass}
              inputMode="numeric"
              min="0"
              onChange={(event) => setBudget(event.target.value)}
              placeholder="Ví dụ: 2000000"
              type="number"
              value={budget}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[#334155]">Ngày tham quan</span>
            <input
              className={inputClass}
              min={todayInputValue()}
              onChange={(event) => setVisitDate(event.target.value)}
              type="date"
              value={visitDate}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[#334155]">Người lớn</span>
            <input
              className={inputClass}
              min="0"
              onChange={(event) => setAdults(Number(event.target.value))}
              placeholder="Số người lớn"
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
              placeholder="Số trẻ em"
              type="number"
              value={children}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[#334155]">Thành phố</span>
            <input
              className={inputClass}
              onChange={(event) => setCity(event.target.value)}
              placeholder="Thành phố (tuỳ chọn)"
              type="text"
              value={city}
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

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
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

          <button
            className="h-fit self-end rounded-2xl bg-[#00474d] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-95"
            disabled={loading}
            type="submit"
          >
            {loading ? 'Đang tìm gợi ý...' : 'Gợi ý cho tôi'}
          </button>
        </div>
      </form>

      {loading && (
        <div className="rounded-3xl border border-[#cbd5db] bg-[#f8fafb] p-6 text-sm font-medium text-[#334155] shadow-sm">
          Đang tìm gợi ý phù hợp...
        </div>
      )}

      {result && (
        <div className="space-y-8">
          {result.overallSummary && (
            <div className="rounded-3xl border border-[#cbd5db] bg-[#f8fafb] p-6 text-sm leading-7 text-[#334155]">
              {result.overallSummary}
            </div>
          )}

          {result.interestMatch?.interestFallbackUsed && (
            <div className="rounded-3xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
              {result.interestMatch.fallbackMessage}
            </div>
          )}

          {result.rankingNotice && (
            <div className="rounded-3xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
              {result.rankingNotice}
            </div>
          )}

          {result.availabilityChecked && (
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
              Đã kiểm tra tình trạng còn vé cho ngày {result.availabilityDate || visitDate}
              {formatCheckedAt(result.availabilityCheckedAt)
                ? ` lúc ${formatCheckedAt(result.availabilityCheckedAt)}`
                : ''}.
              {' '}Số lượng có thể thay đổi và sẽ được kiểm tra lại khi đặt vé.
            </div>
          )}

          {Array.isArray(result.recommendedAttractions) && result.recommendedAttractions.length > 0 && (
            <div>
              <h3 className="mb-2 text-xl font-bold text-[#00474d]">
                Các lựa chọn phù hợp
              </h3>
              {result.recommendationMode === 'INDEPENDENT_ALTERNATIVES' && (
                <p className="mb-4 text-sm text-[#64748b]">
                  Mỗi thẻ là một lựa chọn độc lập, không phải các điểm được xếp chung trong một ngày.
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-3">
                {result.recommendedAttractions.map((item, index) => {
                  const attractionId = item.attractionId || item.id
                  const detailUrl = buildAiDetailUrl(attractionId, aiDetailCriteria)
                  return (
                    <div
                      className="rounded-3xl border border-[#e2e8f0] bg-white p-5 shadow-sm"
                      key={`${attractionId || index}-${item.title || item.name}`}
                    >
                      <h4 className="mb-2 text-lg font-semibold text-[#0f172a]">
                        {item.title || item.name || 'Địa điểm thú vị'}
                      </h4>
                      <p className="mb-4 text-sm text-[#475569]">{item.reason || 'Lý do gợi ý cho bạn.'}</p>
                      {item.suggestedVisitTime?.label && (
                        <p className="mb-2 text-xs font-semibold text-[#00629d]">
                          Khung giờ vào cửa chung: {item.suggestedVisitTime.label}
                        </p>
                      )}
                      {item.availabilityNote && (
                        <p className="mb-4 text-xs font-semibold text-emerald-700">{item.availabilityNote}</p>
                      )}
                      <button
                        className="rounded-2xl bg-[#00474d] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-95"
                        disabled={!attractionId}
                        onClick={() => navigate(detailUrl || `/attractions/${attractionId}`)}
                        type="button"
                      >
                        Xem chi tiết
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {ticketPackages.length > 0 && (
            <div>
              <h3 className="mb-4 text-xl font-bold text-[#00474d]">
                Chi phí theo từng lựa chọn
              </h3>
              <div className="space-y-4">
                {ticketPackages.map((ticketPackage, index) => {
                  const attractionId =
                    ticketPackage.attractionId || ticketPackage.id || ticketPackage.attraction?.id
                  const packageName =
                    ticketPackage.attractionTitle
                    || ticketPackage.name
                    || ticketPackage.title
                    || 'Gói vé phù hợp'
                  const ticketLines = Array.isArray(ticketPackage.tickets)
                    ? ticketPackage.tickets
                    : ticketPackage.items || []
                  const bookableTicketLines = ticketLines.filter((ticket) => ticket?.ticketId)
                  const fallbackBookingDate =
                    ticketPackage.availabilityDate || result.availabilityDate || visitDate
                  const detailUrl = buildAiDetailUrl(attractionId, {
                    ...aiDetailCriteria,
                    visitDate: fallbackBookingDate,
                  })

                  return (
                    <div
                      className="flex flex-col gap-4 rounded-3xl border border-[#e2e8f0] bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between"
                      key={`${packageName}-${index}`}
                    >
                      <div>
                        <h4 className="text-lg font-semibold text-[#0f172a]">{packageName}</h4>
                        {ticketPackage.packageDescription && (
                          <p className="mt-1 text-xs font-semibold text-[#64748b]">
                            {ticketPackage.packageDescription}
                          </p>
                        )}
                        {ticketPackage.suggestedVisitTime?.label && (
                          <p className="mt-2 text-xs font-semibold text-[#00629d]">
                            Khung giờ vào cửa chung: {ticketPackage.suggestedVisitTime.label}
                          </p>
                        )}
                        <div className="mt-2 text-sm text-[#475569]">
                          {ticketLines.length > 0 ? (
                            <ul className="list-disc space-y-1 pl-5">
                              {ticketLines.map((ticket, ticketIndex) => {
                                const slot = ticket.suggestedTimeSlot
                                const refundLabel = refundPolicyLabel(ticket)
                                return (
                                  <li key={ticketIndex}>
                                    {ticket.ticketName || ticket.name || ticket.title || ''} — {ticket.quantity} vé × {(ticket.unitPrice || 0).toLocaleString('vi-VN')}đ
                                    {slot?.startTime && slot?.endTime
                                      ? ` · ${slot.startTime}-${slot.endTime}`
                                      : ''}
                                    {refundLabel ? ` · ${refundLabel}` : ''}
                                    {ticket.eligibility?.note
                                      ? ` · ${ticket.eligibility.note}`
                                      : ''}
                                  </li>
                                )
                              })}
                            </ul>
                          ) : (
                            <p>Thông tin vé sẽ được hiển thị sau khi chọn.</p>
                          )}
                        </div>
                        <p className="mt-3 text-sm font-semibold text-[#00474d]">
                          Tổng tiền: {formatCurrency(
                            ticketPackage.totalPrice || ticketPackage.price || ticketPackage.total || 0,
                          )}
                        </p>
                      </div>
                      <div className="flex min-w-[180px] flex-col gap-2">
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
                                className="rounded-2xl bg-[#00474d] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-95"
                                disabled={!attractionId}
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
                            className="rounded-2xl bg-[#00474d] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-95"
                            disabled={!attractionId}
                            onClick={() => navigate(detailUrl || `/attractions/${attractionId}`)}
                            type="button"
                          >
                            Xem chi tiết
                          </button>
                        )}
                        {bookableTicketLines.length > 1 && (
                          <p className="text-center text-[11px] font-semibold text-[#64748b]">
                            Đặt riêng từng loại vé để giữ đúng số lượng.
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default AIRecommendSection
