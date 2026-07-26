import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import Header from '../components/Header.jsx'
import Seo from '../components/Seo.jsx'
import { CATEGORY_OPTIONS } from '../constants/travelCriteria.js'
import { joinPartyRoom, previewPartyInvite } from '../services/partyApi.js'
import { loadPartySession, savePartySession } from '../utils/partySession.js'

const avatarOptions = [
  { value: 'teal', color: 'bg-teal-500' },
  { value: 'blue', color: 'bg-blue-500' },
  { value: 'violet', color: 'bg-violet-500' },
  { value: 'rose', color: 'bg-rose-500' },
  { value: 'amber', color: 'bg-amber-500' },
  { value: 'emerald', color: 'bg-emerald-500' },
]

const formatInviteDate = (value) => {
  if (!value) return ''
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

function PartyJoinPage() {
  const { roomId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const inviteToken = searchParams.get('invite') || ''
  const existingSession = useMemo(() => loadPartySession(roomId), [roomId])
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(Boolean(inviteToken))
  const [previewError, setPreviewError] = useState('')
  const [form, setForm] = useState({
    displayName: '',
    avatarKey: 'teal',
    budgetCap: 500000,
    preferences: [],
  })
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!inviteToken) {
      return undefined
    }
    previewPartyInvite(roomId, inviteToken)
      .then((response) => {
        if (!cancelled) setPreview(response?.data || null)
      })
      .catch((error) => {
        if (!cancelled) {
          setPreview(null)
          setPreviewError(error.message)
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [inviteToken, roomId])

  const togglePreference = (value) => {
    setForm((current) => ({
      ...current,
      preferences: current.preferences.includes(value)
        ? current.preferences.filter((item) => item !== value)
        : [...current.preferences, value].slice(0, 5),
    }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (joining || !inviteToken) return
    setJoining(true)
    try {
      const response = await joinPartyRoom(roomId, {
        displayName: form.displayName,
        avatarKey: form.avatarKey,
        budgetCap: Number(form.budgetCap),
        preferences: { categories: form.preferences },
        inviteToken,
      })
      const session = response?.data
      if (!session?.partyToken || !session?.room?.id) {
        throw new Error('Máy chủ chưa tạo được phiên tham gia.')
      }
      savePartySession(roomId, session)
      toast.success(`Chào ${form.displayName}, bạn đã vào phòng!`)
      navigate(`/party/${roomId}`, { replace: true })
    } catch (error) {
      toast.error(error.message)
    } finally {
      setJoining(false)
    }
  }

  return (
    <>
      <Seo
        title="Tham gia PartySync | VietTicket"
        description="Tham gia phòng lập kế hoạch du lịch nhóm và bình chọn địa điểm."
      />
      <Header />
      <main className="relative min-h-[calc(100vh-80px)] overflow-hidden bg-[#eef8f7] px-5 py-10">
        <div className="absolute -left-24 top-20 h-72 w-72 rounded-full bg-[#62dfd1]/25 blur-3xl" />
        <div className="absolute -right-24 bottom-0 h-80 w-80 rounded-full bg-amber-300/20 blur-3xl" />
        <div className="relative mx-auto grid max-w-5xl overflow-hidden rounded-[32px] border border-white bg-white shadow-2xl shadow-[#004e50]/10 lg:grid-cols-[0.78fr_1.22fr]">
          <section className="bg-[#064b50] p-8 text-white md:p-10">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
              <span className="material-symbols-outlined text-3xl text-[#8ff9ec]">diversity_3</span>
            </span>
            <p className="mt-8 text-xs font-black uppercase tracking-[0.18em] text-[#8ff9ec]">
              VietTicket PartySync
            </p>
            <h1 className="mt-3 text-3xl font-black leading-tight text-white">
              Bạn được mời cùng lên kế hoạch chuyến đi
            </h1>
            <p className="mt-5 text-sm leading-7 text-white/70">
              Bạn chỉ cần tên hiển thị. Phiên này chỉ có quyền vote trong đúng phòng,
              không truy cập booking hoặc tài khoản của Host.
            </p>
            {preview && (
              <div className="mt-6 rounded-2xl border border-white/15 bg-white/10 p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#8ff9ec]">
                  Chuyến đi bạn sắp tham gia
                </p>
                <h2 className="mt-2 text-xl font-black text-white">{preview.title}</h2>
                <p className="mt-2 text-sm leading-6 text-white/75">
                  {preview.city} · {formatInviteDate(preview.startDate)} · {preview.dayCount} ngày
                </p>
                <p className="mt-1 text-xs font-semibold text-white/60">
                  Host: {preview.host?.fullName} · {preview.memberCount}/{preview.maxMembers} người đang trong phòng
                </p>
              </div>
            )}
            <div className="mt-8 space-y-4 text-sm font-semibold text-white/85">
              {[
                ['favorite', 'Chọn điểm bạn thực sự muốn đi'],
                ['payments', 'Chia sẻ mức chi thoải mái'],
                ['route', 'Xem lịch trình chung sau khi chốt'],
              ].map(([icon, label]) => (
                <div className="flex items-center gap-3" key={label}>
                  <span className="material-symbols-outlined text-[#8ff9ec]">{icon}</span>
                  {label}
                </div>
              ))}
            </div>
          </section>

          <section className="p-6 md:p-10">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#008b84]">
                Hồ sơ trong phòng
              </p>
              <h2 className="mt-1 text-2xl font-black">Bạn muốn được gọi là gì?</h2>
            </div>

            {existingSession && (
              <button
                className="mt-5 flex w-full items-center justify-between rounded-xl border border-[#a8dfda] bg-[#effaf8] px-4 py-3 text-left text-sm font-bold text-[#006b68]"
                onClick={() => navigate(`/party/${roomId}`)}
                type="button"
              >
                Bạn đã có phiên trong phòng — mở lại ngay
                <span className="material-symbols-outlined">arrow_forward</span>
              </button>
            )}

            {!inviteToken ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                <span className="material-symbols-outlined text-6xl text-amber-500">link_off</span>
                <h2 className="mt-4 text-2xl font-black">Link mời chưa đầy đủ</h2>
                <p className="mt-2 max-w-sm text-sm text-slate-500">
                  Hãy quét lại QR hoặc nhờ Host gửi link mời PartySync mới.
                </p>
              </div>
            ) : previewLoading ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center text-center" role="status">
                <span className="material-symbols-outlined animate-spin text-5xl text-[#008b84]">
                  progress_activity
                </span>
                <p className="mt-4 font-bold text-slate-600">Đang xác minh lời mời…</p>
              </div>
            ) : previewError || !preview ? (
              <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                <span className="material-symbols-outlined text-6xl text-amber-500">link_off</span>
                <h2 className="mt-4 text-2xl font-black">Không thể dùng lời mời này</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
                  {previewError || 'Lời mời không còn hiệu lực. Hãy nhờ Host tạo mã QR mới.'}
                </p>
              </div>
            ) : (
              <>
                <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
                  <label className="block">
                    <span className="text-sm font-extrabold text-slate-700">Tên hiển thị</span>
                    <input
                      autoComplete="nickname"
                      className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3.5 outline-none transition focus:border-[#008b84] focus:ring-4 focus:ring-[#008b84]/10"
                      maxLength="40"
                      minLength="2"
                      onChange={(event) =>
                        setForm((current) => ({ ...current, displayName: event.target.value }))
                      }
                      placeholder="Ví dụ: Minh Anh"
                      required
                      value={form.displayName}
                    />
                  </label>

                  <fieldset>
                    <legend className="text-sm font-extrabold text-slate-700">Màu đại diện</legend>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {avatarOptions.map((avatar, index) => (
                        <label className="cursor-pointer" key={avatar.value}>
                          <input
                            aria-label={`Màu đại diện ${index + 1}`}
                            checked={form.avatarKey === avatar.value}
                            className="sr-only"
                            name="avatar"
                            onChange={() =>
                              setForm((current) => ({ ...current, avatarKey: avatar.value }))
                            }
                            type="radio"
                            value={avatar.value}
                          />
                          <span
                            className={`flex h-10 w-10 items-center justify-center rounded-full ${avatar.color} text-sm font-black text-white transition ${
                              form.avatarKey === avatar.value
                                ? 'ring-4 ring-[#006b68]/20 ring-offset-2'
                                : ''
                            }`}
                          >
                            {form.displayName.trim().charAt(0).toUpperCase() || '•'}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <label className="block">
                    <span className="flex items-center justify-between gap-3 text-sm font-extrabold text-slate-700">
                      Mức chi vé thoải mái của bạn
                      <strong className="text-[#006b68]">
                        {Number(form.budgetCap || 0).toLocaleString('vi-VN')}đ
                      </strong>
                    </span>
                    <input
                      className="mt-2 w-full accent-[#006b68]"
                      max="5000000"
                      min="50000"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          budgetCap: Number(event.target.value),
                        }))
                      }
                      step="50000"
                      type="range"
                      value={form.budgetCap}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      Đây là tín hiệu tham khảo để cân bằng phương án, không phải cam kết thanh toán.
                    </p>
                  </label>

                  <fieldset>
                    <legend className="text-sm font-extrabold text-slate-700">
                      Bạn thích trải nghiệm nào?
                    </legend>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {CATEGORY_OPTIONS.map((option) => {
                        const selected = form.preferences.includes(option.value)
                        return (
                          <button
                            aria-pressed={selected}
                            className={`rounded-full border px-3 py-2 text-xs font-bold transition ${
                              selected
                                ? 'border-[#008b84] bg-[#dff7f3] text-[#005b59]'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                            }`}
                            key={option.value}
                            onClick={() => togglePreference(option.value)}
                            type="button"
                          >
                            {selected ? '✓ ' : ''}{option.label}
                          </button>
                        )
                      })}
                    </div>
                  </fieldset>

                  <button
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006b68] px-5 py-4 font-extrabold text-white shadow-lg shadow-[#006b68]/20 transition hover:bg-[#005b59] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={joining}
                    type="submit"
                  >
                    <span className={`material-symbols-outlined ${joining ? 'animate-spin' : ''}`}>
                      {joining ? 'progress_activity' : 'login'}
                    </span>
                    {joining ? 'Đang tham gia...' : 'Vào phòng bình chọn'}
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      </main>
    </>
  )
}

export default PartyJoinPage
