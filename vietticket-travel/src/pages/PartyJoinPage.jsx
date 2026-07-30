import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'react-toastify'
import Header from '../components/Header.jsx'
import Seo from '../components/Seo.jsx'
import { joinPartyRoom, previewPartyInvite } from '../services/partyApi.js'
import { loadPartySession, savePartySession } from '../utils/partySession.js'

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

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (joining || !inviteToken) return
    setJoining(true)
    try {
      const response = await joinPartyRoom(roomId, {
        displayName: form.displayName,
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
                ['login', 'Vào phòng ngay sau khi nhập tên'],
                ['touch_app', 'Bình chọn cùng mọi người trong phòng'],
                ['tune', 'Bổ sung gu, avatar và ngân sách sau'],
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
                Tham gia nhanh
              </p>
              <h2 className="mt-1 text-2xl font-black">Nhập tên để vào phòng</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Chỉ tên hiển thị là bắt buộc. Avatar, gu du lịch và mức chi chỉ là thông tin gợi ý,
                bạn có thể bổ sung sau khi vào phòng.
              </p>
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

                  <button
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#006b68] px-5 py-4 font-extrabold text-white shadow-lg shadow-[#006b68]/20 transition hover:bg-[#005b59] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={joining}
                    type="submit"
                  >
                    <span className={`material-symbols-outlined ${joining ? 'animate-spin' : ''}`}>
                      {joining ? 'progress_activity' : 'login'}
                    </span>
                    {joining ? 'Đang tham gia...' : 'Tham gia phòng ngay'}
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
