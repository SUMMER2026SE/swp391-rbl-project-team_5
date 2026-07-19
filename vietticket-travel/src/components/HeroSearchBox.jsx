import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { featuredDestinations } from '../data/landingData.js'

const intentSuggestions = [
  {
    label: 'Công viên chủ đề',
    subtitle: 'Gia đình, nhóm bạn, cuối tuần',
    icon: 'fort',
    params: { category: 'Theme Park & Resort', sort: 'popular' },
  },
  {
    label: 'Thiên nhiên thư giãn',
    subtitle: 'Di sản, cảnh đẹp, đi nhẹ nhàng',
    icon: 'forest',
    params: { category: 'Nature & Sightseeing', sort: 'rating' },
  },
  {
    label: 'Vé dưới 500k',
    subtitle: 'Ưu tiên lựa chọn tiết kiệm',
    icon: 'savings',
    params: { maxPrice: '500000', sort: 'price-asc' },
  },
]

const clampGuestCount = (value) => {
  const guests = Number(value)
  if (!Number.isFinite(guests)) return 1
  return Math.max(1, Math.min(20, Math.round(guests)))
}

const toDateInputValue = (date) => {
  const timezoneOffset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - timezoneOffset).toISOString().split('T')[0]
}

const normalizeText = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

function HeroSearchBox() {
  const navigate = useNavigate()
  const [destination, setDestination] = useState('')
  const [visitDate, setVisitDate] = useState('')
  const [guestCount, setGuestCount] = useState(2)
  const [isFocused, setIsFocused] = useState(false)
  const today = useMemo(() => toDateInputValue(new Date()), [])

  const destinationSuggestions = useMemo(() => {
    const normalizedQuery = normalizeText(destination)
    const featured = featuredDestinations.map((item) => ({
      label: item.title,
      subtitle: item.city,
      icon: 'location_on',
      params: {
        search: item.searchQuery || item.title,
        city: item.city,
      },
    }))

    const combined = [...featured, ...intentSuggestions]
    if (!normalizedQuery) return combined.slice(0, 6)

    return combined
      .filter((item) =>
        normalizeText(`${item.label} ${item.subtitle}`).includes(normalizedQuery),
      )
      .slice(0, 6)
  }, [destination])

  const buildSearchUrl = (extraParams = {}) => {
    const params = new URLSearchParams()
    const trimmedDestination = destination.trim()
    const normalizedGuests = clampGuestCount(guestCount)

    if (trimmedDestination) params.set('search', trimmedDestination)
    if (visitDate) params.set('date', visitDate)
    if (normalizedGuests > 1) params.set('qty', String(normalizedGuests))

    Object.entries(extraParams).forEach(([key, value]) => {
      if (value) params.set(key, value)
    })

    const query = params.toString()
    return query ? `/attractions?${query}` : '/attractions'
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    navigate(buildSearchUrl())
  }

  const handleSuggestionClick = (suggestion) => {
    navigate(buildSearchUrl(suggestion.params))
  }

  return (
    <form
      className="relative mt-2 grid w-full max-w-[760px] gap-3 rounded-2xl border border-white/35 bg-white/90 p-3 text-[#1a1c1e] shadow-[0_18px_48px_rgba(0,0,0,0.22)] backdrop-blur-md md:grid-cols-[minmax(0,1.4fr)_160px_120px_auto] md:items-end"
      onSubmit={handleSubmit}
    >
      <label className="relative block">
        <span className="mb-1 block text-xs font-extrabold uppercase text-[#3f484a]">
          Bạn muốn đi đâu?
        </span>
        <span className="material-symbols-outlined pointer-events-none absolute bottom-3 left-3 text-[20px] text-[#006068]" aria-hidden="true">
          search
        </span>
        <input
          aria-autocomplete="list"
          aria-expanded={isFocused && destinationSuggestions.length > 0}
          aria-label="Tìm điểm tham quan hoặc thành phố"
          className="h-12 w-full rounded-xl border border-[#bdc9ca] bg-white pl-10 pr-3 text-sm font-semibold outline-none transition focus:border-[#006068] focus:ring-2 focus:ring-[#006068]/20"
          onBlur={() => window.setTimeout(() => setIsFocused(false), 120)}
          onChange={(event) => setDestination(event.target.value)}
          onFocus={() => setIsFocused(true)}
          placeholder="Bà Nà Hills, Phú Quốc..."
          type="search"
          value={destination}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-extrabold uppercase text-[#3f484a]">
          Ngày đi
        </span>
        <input
          className="h-12 w-full rounded-xl border border-[#bdc9ca] bg-white px-3 text-sm font-semibold outline-none transition focus:border-[#006068] focus:ring-2 focus:ring-[#006068]/20"
          min={today}
          onChange={(event) => setVisitDate(event.target.value)}
          type="date"
          value={visitDate}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-extrabold uppercase text-[#3f484a]">
          Số khách
        </span>
        <input
          className="h-12 w-full rounded-xl border border-[#bdc9ca] bg-white px-3 text-sm font-semibold outline-none transition focus:border-[#006068] focus:ring-2 focus:ring-[#006068]/20"
          max="20"
          min="1"
          onChange={(event) => setGuestCount(clampGuestCount(event.target.value))}
          type="number"
          value={guestCount}
        />
      </label>

      <button
        className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#feb700] px-5 text-sm font-extrabold text-[#3d2a00] shadow-sm transition hover:bg-[#e5a600] active:scale-[0.98]"
        type="submit"
      >
        <span className="material-symbols-outlined text-[19px]" aria-hidden="true">
          travel_explore
        </span>
        Tìm vé
      </button>

      {isFocused && destinationSuggestions.length > 0 && (
        <div className="absolute left-3 right-3 top-[88px] z-20 overflow-hidden rounded-2xl border border-[#bdc9ca]/70 bg-white text-left shadow-[0_20px_44px_rgba(0,40,50,0.18)] md:right-auto md:top-[86px] md:w-[420px]">
          {destinationSuggestions.map((suggestion) => (
            <button
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#eefcff]"
              key={`${suggestion.label}-${suggestion.subtitle}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSuggestionClick(suggestion)}
              type="button"
            >
              <span className="material-symbols-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eefcff] text-[20px] text-[#006068]" aria-hidden="true">
                {suggestion.icon}
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-sm text-[#1a1c1e]">
                  {suggestion.label}
                </strong>
                <span className="block truncate text-xs font-semibold text-[#3e494a]">
                  {suggestion.subtitle}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </form>
  )
}

export default HeroSearchBox
