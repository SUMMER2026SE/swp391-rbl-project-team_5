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

function formatCurrency(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Liên hệ'
  }
  return `${new Intl.NumberFormat('vi-VN').format(amount)} VND`
}

const inputClass =
  'w-full rounded-2xl border border-[#cbd5db] bg-[#f8fafb] px-4 py-3 text-sm text-[#0f172a] outline-none transition focus:border-[#00474d] focus:ring-2 focus:ring-[#00474d]/20'

function AIRecommendSection() {
  const navigate = useNavigate()
  const [budget, setBudget] = useState('')
  const [adults, setAdults] = useState(2)
  const [children, setChildren] = useState(0)
  const [city, setCity] = useState('')
  const [categories, setCategories] = useState([])
  const [priority, setPriority] = useState('balanced')
  const [companion, setCompanion] = useState('solo')
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
      if (adultsValue + childrenValue <= 0) {
        toast.warning('Vui lòng nhập số người (ít nhất 1 người).')
        return
      }

      setLoading(true)
      setResult(null)

      try {
        const response = await aiRecommend({
          budget: budgetValue,
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
    [budget, adults, children, city, categories, priority, companion],
  )

  return (
    <section className="my-12 rounded-[28px] border border-[#e2e8f0] bg-white p-6 shadow-[0_18px_60px_rgba(0,71,77,0.06)]">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#00474d]">✨ Gợi ý địa điểm theo tiêu chí của bạn</h2>
          <p className="mt-2 max-w-2xl text-sm text-[#475569]">
            Cho chúng tôi biết ngân sách, số người, sở thích và phong cách đi — chúng tôi sẽ đề xuất địa điểm & combo vé hợp gu nhất.
          </p>
        </div>
      </div>

      <form className="mb-8 space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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

          {Array.isArray(result.recommendedAttractions) && result.recommendedAttractions.length > 0 && (
            <div>
              <h3 className="mb-4 text-xl font-bold text-[#00474d]">Địa điểm gợi ý</h3>
              <div className="grid gap-4 md:grid-cols-3">
                {result.recommendedAttractions.map((item, index) => {
                  const attractionId = item.attractionId || item.id
                  return (
                    <div
                      className="rounded-3xl border border-[#e2e8f0] bg-white p-5 shadow-sm"
                      key={`${attractionId || index}-${item.title || item.name}`}
                    >
                      <h4 className="mb-2 text-lg font-semibold text-[#0f172a]">
                        {item.title || item.name || 'Địa điểm thú vị'}
                      </h4>
                      <p className="mb-4 text-sm text-[#475569]">{item.reason || 'Lý do gợi ý cho bạn.'}</p>
                      <button
                        className="rounded-2xl bg-[#00474d] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-95"
                        disabled={!attractionId}
                        onClick={() => navigate(`/attractions/${attractionId}`)}
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

          {Array.isArray(result.combos) && result.combos.length > 0 && (
            <div>
              <h3 className="mb-4 text-xl font-bold text-[#00474d]">Combo vé đề xuất</h3>
              <div className="space-y-4">
                {result.combos.map((combo, index) => {
                  const attractionId = combo.attractionId || combo.id || combo.attraction?.id
                  const comboName = combo.attractionTitle || combo.name || combo.title || 'Combo vé hấp dẫn'
                  const ticketLines = Array.isArray(combo.tickets)
                    ? combo.tickets
                    : combo.items || []

                  return (
                    <div
                      className="flex flex-col gap-4 rounded-3xl border border-[#e2e8f0] bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between"
                      key={`${comboName}-${index}`}
                    >
                      <div>
                        <h4 className="text-lg font-semibold text-[#0f172a]">{comboName}</h4>
                        <div className="mt-2 text-sm text-[#475569]">
                          {ticketLines.length > 0 ? (
                            <ul className="list-disc space-y-1 pl-5">
                              {ticketLines.map((ticket, ticketIndex) => (
                                <li key={ticketIndex}>
                                  {ticket.ticketName || ticket.name || ticket.title || ''} — {ticket.quantity} vé × {(ticket.unitPrice || 0).toLocaleString('vi-VN')}đ
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>Thông tin vé sẽ được hiển thị sau khi chọn.</p>
                          )}
                        </div>
                        <p className="mt-3 text-sm font-semibold text-[#00474d]">
                          Tổng tiền: {formatCurrency(combo.totalPrice || combo.price || combo.total || 0)}
                        </p>
                      </div>
                      <button
                        className="rounded-2xl bg-[#00474d] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00629d] active:scale-95"
                        disabled={!attractionId}
                        onClick={() => navigate(`/attractions/${attractionId}`)}
                        type="button"
                      >
                        Đặt vé ngay
                      </button>
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
