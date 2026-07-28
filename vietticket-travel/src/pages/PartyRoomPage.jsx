import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'react-toastify'
import AIItineraryRouteMap from '../components/AIItineraryRouteMap.jsx'
import Footer from '../components/Footer.jsx'
import Header from '../components/Header.jsx'
import Seo from '../components/Seo.jsx'
import { CATEGORY_OPTIONS } from '../constants/travelCriteria.js'
import { useAuth } from '../context/useAuth.js'
import usePartyRoomSocket from '../hooks/usePartyRoomSocket.js'
import {
  clearPartyCandidateVote,
  closePartyRoom,
  finalizePartyRoom,
  getPartyRoomSession,
  removePartyMember,
  reopenPartyRoom,
  rotatePartyInvite,
  updatePartyMember,
  votePartyCandidate,
} from '../services/partyApi.js'
import { activateLiveTrip } from '../services/liveTripApi.js'
import {
  createItineraryBookingQueue,
  saveItineraryBookingQueue,
} from '../utils/aiItineraryBookingQueue.js'
import {
  clearPartyInvite,
  clearPartySession,
  loadPartyInvite,
  loadPartySession,
  savePartyInvite,
} from '../utils/partySession.js'

const avatarClass = {
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  violet: 'bg-violet-500',
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
  indigo: 'bg-indigo-500',
  coral: 'bg-orange-500',
}

const voteOptions = [
  {
    value: 'VETO',
    icon: 'block',
    label: 'Không thể đi',
    active: 'border-rose-400 bg-rose-50 text-rose-700 ring-2 ring-rose-100',
  },
  {
    value: 'LIKE',
    icon: 'thumb_up',
    label: 'Phù hợp',
    active: 'border-sky-400 bg-sky-50 text-sky-700 ring-2 ring-sky-100',
  },
  {
    value: 'LOVE',
    icon: 'favorite',
    label: 'Rất muốn đi',
    active: 'border-amber-400 bg-amber-50 text-amber-700 ring-2 ring-amber-100',
  },
]

const statusMeta = {
  OPEN: { label: 'Đang bình chọn', className: 'bg-emerald-100 text-emerald-800', icon: 'how_to_vote' },
  FINALIZED: { label: 'Đã chốt lịch', className: 'bg-sky-100 text-sky-800', icon: 'task_alt' },
  CLOSED: { label: 'Đã đóng', className: 'bg-slate-200 text-slate-700', icon: 'lock' },
  EXPIRED: { label: 'Hết hạn', className: 'bg-slate-200 text-slate-700', icon: 'timer_off' },
}
const EMPTY_LIST = Object.freeze([])

const formatCurrency = (value) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value || 0))

const formatDate = (value) => {
  if (!value) return ''
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

const formatDateTime = (value) => {
  if (!value) return ''
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function PartyRoomPage() {
  const { roomId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { isAuthenticated, isAuthLoading, user } = useAuth()
  const guestSession = useMemo(() => loadPartySession(roomId), [roomId])
  const [partyToken] = useState(guestSession?.partyToken || '')
  const [inviteToken, setInviteToken] = useState(
    () => location.state?.inviteToken || loadPartyInvite(roomId),
  )
  const [room, setRoom] = useState(null)
  const [loading, setLoading] = useState(true)
  const [accessError, setAccessError] = useState('')
  const [action, setAction] = useState('')
  const [voteBusy, setVoteBusy] = useState('')
  const refreshTimer = useRef(null)

  useEffect(() => {
    if (location.state?.inviteToken) {
      savePartyInvite(roomId, location.state.inviteToken)
    }
  }, [location.state, roomId])

  const refreshRoom = useCallback(async ({ silent = false } = {}) => {
    if (!roomId || isAuthLoading) return
    if (!silent) setLoading(true)
    try {
      const response = await getPartyRoomSession(roomId, partyToken)
      setRoom(response?.data || null)
      setAccessError('')
    } catch (error) {
      if (error.status === 401 || error.status === 404) {
        if (partyToken) clearPartySession(roomId)
        setAccessError(error.message)
      } else if (!silent) {
        toast.error(error.message)
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [isAuthLoading, partyToken, roomId])

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshRoom(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshRoom])

  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(() => {
      void refreshRoom({ silent: true })
    }, 120)
  }, [refreshRoom])

  useEffect(() => () => window.clearTimeout(refreshTimer.current), [])

  const roomMeId = room?.me?.id
  const roomVotes = room?.votes || EMPTY_LIST
  const roomCandidates = room?.candidates || EMPTY_LIST

  const handleRevoked = useCallback((payload) => {
    if (!partyToken) return
    if (payload?.memberId && payload.memberId !== roomMeId) return
    clearPartySession(roomId)
    setAccessError('Host đã thu hồi quyền tham gia phòng này.')
    setRoom(null)
  }, [partyToken, roomMeId, roomId])

  const connectionState = usePartyRoomSocket({
    roomId,
    partyToken,
    onUpdate: scheduleRefresh,
    onRevoked: handleRevoked,
  })

  const myVotes = useMemo(
    () => new Map(
      roomVotes
        .filter((vote) => vote.memberId === roomMeId)
        .map((vote) => [vote.candidateId, vote.value]),
    ),
    [roomMeId, roomVotes],
  )
  const votingMemberCount = useMemo(
    () => new Set(roomVotes.map((vote) => vote.memberId)).size,
    [roomVotes],
  )
  const requiredVoters = Number(
    room?.votingPolicy?.requiredVoters
      || Math.max(2, Math.ceil((room?.members?.length || 0) * 0.6)),
  )
  const endorsedCandidateCount = useMemo(
    () => roomCandidates.filter((candidate) => {
      const votes = roomVotes.filter((vote) => vote.candidateId === candidate.id)
      return (
        votes.some((vote) => ['LOVE', 'LIKE'].includes(vote.value))
        && !votes.some((vote) => vote.value === 'VETO')
      )
    }).length,
    [roomCandidates, roomVotes],
  )
  const isHost = Boolean(room?.me?.isHost)
  const isOpen = room?.status === 'OPEN'
  const status = statusMeta[room?.status] || statusMeta.CLOSED
  const latestPlan = room?.latestDecision?.snapshot || null
  const showCurrentDecision = Boolean(
    latestPlan
    && (
      room?.status === 'FINALIZED'
      || (['CLOSED', 'EXPIRED'].includes(room?.status) && room?.finalizedAt)
    ),
  )
  const inviteUrl = useMemo(
    () => inviteToken
      ? `${window.location.origin}/party/join/${encodeURIComponent(roomId)}?invite=${encodeURIComponent(inviteToken)}`
      : '',
    [inviteToken, roomId],
  )

  const handleVote = async (candidateId, value) => {
    if (!isOpen || voteBusy) return
    setVoteBusy(candidateId)
    try {
      const response = myVotes.get(candidateId) === value
        ? await clearPartyCandidateVote(roomId, candidateId, partyToken)
        : await votePartyCandidate(roomId, candidateId, value, partyToken)
      setRoom(response?.data || room)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setVoteBusy('')
    }
  }

  const handleFinalize = async () => {
    if (action) return
    if (
      votingMemberCount < room.members.length
      && !window.confirm(
        `Đã đủ ngưỡng ${requiredVoters}/${room.members.length} người, nhưng vẫn còn ${room.members.length - votingMemberCount} người chưa vote. Bạn vẫn muốn chốt?`,
      )
    ) {
      return
    }
    setAction('finalize')
    try {
      const response = await finalizePartyRoom(roomId)
      setRoom(response?.data || room)
      toast.success('Đã chốt lịch trình đồng thuận từ dữ liệu vé mới nhất.')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setAction('')
    }
  }

  const handleReopen = async () => {
    if (action) return
    setAction('reopen')
    try {
      const response = await reopenPartyRoom(roomId)
      setRoom(response?.data || room)
      toast.success('Đã mở lại bình chọn. Kết quả cũ vẫn được lưu trong lịch sử.')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setAction('')
    }
  }

  const handleRotateInvite = async () => {
    if (action) return
    setAction('invite')
    try {
      const response = await rotatePartyInvite(roomId)
      const token = response?.data?.inviteToken
      if (!token) throw new Error('Không tạo được link mời.')
      savePartyInvite(roomId, token)
      setInviteToken(token)
      toast.success('Đã tạo link mời mới. Link cũ không còn hiệu lực.')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setAction('')
    }
  }

  const handleCopyInvite = async () => {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      toast.success('Đã sao chép link mời.')
    } catch {
      toast.info(inviteUrl)
    }
  }

  const handleRemoveMember = async (member) => {
    if (!window.confirm(`Thu hồi quyền của ${member.displayName}? Bình chọn của thành viên này sẽ không còn được tính.`)) {
      return
    }
    setAction(`remove-${member.id}`)
    try {
      const response = await removePartyMember(roomId, member.id)
      setRoom(response?.data || room)
      toast.success(`Đã đưa ${member.displayName} ra khỏi phòng.`)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setAction('')
    }
  }

  const handleClose = async () => {
    const closeMessage = room.status === 'FINALIZED'
      ? 'Đóng phòng sẽ hủy quy trình đặt các vé còn lại từ lịch nhóm và vô hiệu hóa link mời. Các vé đã mua (nếu có) không bị hủy. Tiếp tục?'
      : 'Đóng phòng sẽ ngừng nhận vote và vô hiệu hóa link mời. Tiếp tục?'
    if (!window.confirm(closeMessage)) return
    setAction('close')
    try {
      const response = await closePartyRoom(roomId)
      setRoom((current) => (
        current && response?.data
          ? { ...current, ...response.data }
          : current
      ))
      clearPartyInvite(roomId)
      setInviteToken('')
      toast.success('Đã đóng phòng.')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setAction('')
    }
  }

  const handleStartBooking = () => {
    if (!latestPlan) return
    const queue = createItineraryBookingQueue(latestPlan, {
      fallbackStartDate: room.startDate,
      ownerId: user?.id || user?.userId || '',
      queueId: room.savedItinerary?.id
        ? `itinerary-${room.savedItinerary.id}-v${room.version}`
        : undefined,
      itineraryId: room.savedItinerary?.id,
      itineraryVersion: room.version,
      partyRoomId: room.id,
    })
    if (!queue) {
      toast.warning('Lịch trình chưa có dòng vé phù hợp để bắt đầu đặt.')
      return
    }
    saveItineraryBookingQueue(queue)
    navigate(`/itinerary-checkout/${queue.id}`)
  }

  const handleActivateLive = async () => {
    const planId = room?.savedItinerary?.planId
    if (!planId || action) return
    setAction('live')
    try {
      const response = await activateLiveTrip(planId, { startDate: room.startDate })
      const trip = response?.data
      if (!trip?.id) throw new Error('Không kích hoạt được Live Trip.')
      toast.success('Đã bật VietTicket Live cho lịch trình nhóm.')
      navigate(`/trip-mode/${trip.id}`)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setAction('')
    }
  }

  if (loading || isAuthLoading) {
    return (
      <>
        <Header />
        <main className="flex min-h-[70vh] items-center justify-center bg-[#f5f8f8]">
          <div className="text-center">
            <span className="material-symbols-outlined animate-spin text-5xl text-[#006b68]">
              progress_activity
            </span>
            <p className="mt-3 font-bold text-slate-600">Đang kết nối phòng PartySync…</p>
          </div>
        </main>
      </>
    )
  }

  if (accessError || !room) {
    return (
      <>
        <Header />
        <main className="flex min-h-[70vh] items-center justify-center bg-[#f5f8f8] px-5">
          <div className="max-w-lg rounded-3xl border border-slate-200 bg-white p-9 text-center shadow-lg">
            <span className="material-symbols-outlined text-6xl text-amber-500">lock_clock</span>
            <h1 className="mt-5 text-3xl font-black">Không thể mở phòng</h1>
            <p className="mt-3 text-slate-600">
              {accessError || 'Phiên tham gia không còn hợp lệ.'}
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              {isAuthenticated && (
                <Link className="button button--primary" to="/party">
                  Phòng của tôi
                </Link>
              )}
              <Link className="button border border-slate-300 bg-white" to="/">
                Về trang chủ
              </Link>
            </div>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Seo
        title={`${room.title} | PartySync`}
        description={`Phòng bình chọn chuyến đi nhóm tại ${room.city}.`}
      />
      <Header activeLink="PartySync" />
      <main className="min-h-screen bg-[#f5f8f8] pb-20">
        <section className="border-b border-[#0f5f63] bg-[#064b50] px-5 py-8 text-white">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${status.className}`}>
                    <span className="material-symbols-outlined text-base">{status.icon}</span>
                    {status.label}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-bold ${
                      connectionState === 'connected' ? 'text-[#8ff9ec]' : 'text-white/55'
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full bg-current" />
                    {connectionState === 'connected' ? 'Realtime đang kết nối' : 'Đang đồng bộ lại'}
                  </span>
                </div>
                <h1 className="mt-4 max-w-4xl text-3xl font-black leading-tight text-white md:text-5xl">
                  {room.title}
                </h1>
                <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold text-white/70">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-lg">location_on</span>
                    {room.city}
                  </span>
                  <span>{formatDate(room.startDate)}</span>
                  <span>{room.dayCount} ngày</span>
                  <span>{room.adults + room.children} khách</span>
                  <span>{formatCurrency(room.totalBudget)}</span>
                </p>
              </div>
              {isHost && (
                <div className="flex flex-wrap gap-2">
                  {isOpen && (
                    <button
                      className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/15"
                      onClick={() => void handleRotateInvite()}
                      type="button"
                    >
                      <span className="mr-2 material-symbols-outlined align-middle text-lg">qr_code_2</span>
                      {inviteToken ? 'Đổi mã mời' : 'Tạo mã mời'}
                    </button>
                  )}
                  {!['CLOSED', 'EXPIRED'].includes(room.status) && (
                      <button
                        className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-white/45"
                        disabled={action === 'close' || Boolean(room.bookingStartedAt)}
                        onClick={() => void handleClose()}
                        title={
                          room.bookingStartedAt
                            ? 'Không thể đóng phòng khi lịch trình đang có đơn đặt vé.'
                            : 'Đóng và lưu phòng vào lịch sử.'
                        }
                        type="button"
                      >
                      Đóng phòng
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="mt-8 flex items-center gap-3 overflow-x-auto pb-2">
              {room.members.map((member) => (
                <div
                  className="flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/10 py-1.5 pl-1.5 pr-3"
                  key={member.id}
                  title={member.preferences?.categories?.join(', ') || 'Chưa chọn sở thích'}
                >
                  <MemberAvatar member={member} />
                  <span className="text-sm font-bold">
                    {member.displayName}{member.role === 'HOST' ? ' · Host' : ''}
                  </span>
                </div>
              ))}
              <span className="shrink-0 text-xs font-bold text-white/55">
                {room.members.length}/{room.maxMembers} thành viên
              </span>
            </div>
          </div>
        </section>

        <div className="mx-auto grid max-w-7xl gap-7 px-5 py-8 xl:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-7">
            {showCurrentDecision ? (
              <DecisionPanel
                isHost={isHost}
                latestDecision={room.latestDecision}
                members={room.members}
                onActivateLive={handleActivateLive}
                onReopen={handleReopen}
                onStartBooking={handleStartBooking}
                plan={latestPlan}
                room={room}
                runningAction={action}
              />
            ) : (
              <>
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-[#008b84]">
                        Danh sách chung
                      </p>
                      <h2 className="mt-1 text-2xl font-black">Mỗi người một tiếng nói</h2>
                      <p className="mt-2 text-sm text-slate-500">
                        “Không thể đi” là quyền phủ quyết và sẽ loại địa điểm khi chốt.
                        Bấm lại lựa chọn đang chọn để bỏ vote.
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#eef8f7] px-4 py-3 text-right">
                      <strong className="block text-xl text-[#006b68]">{votingMemberCount}/{room.members.length}</strong>
                      <span className="text-xs font-semibold text-slate-500">người đã vote</span>
                    </div>
                  </div>
                </section>

                <section className="grid gap-5 md:grid-cols-2">
                  {room.candidates.map((candidate) => (
                    <CandidateCard
                      busy={voteBusy === candidate.id}
                      candidate={candidate}
                      disabled={!isOpen}
                      key={candidate.id}
                      members={room.members}
                      myVote={myVotes.get(candidate.id)}
                      onVote={handleVote}
                      votes={room.votes.filter((vote) => vote.candidateId === candidate.id)}
                    />
                  ))}
                </section>
              </>
            )}
          </div>

          <aside className="space-y-6">
            {isHost && isOpen && (
              <InvitePanel
                inviteUrl={inviteUrl}
                loading={action === 'invite'}
                onCopy={handleCopyInvite}
                onRotate={handleRotateInvite}
                room={room}
              />
            )}

            <PreferencePanel
              disabled={!isOpen}
              key={`${room.me.id}-${room.me.updatedAt || ''}`}
              member={room.me}
              onSaved={setRoom}
              partyToken={partyToken}
              roomId={room.id}
            />

            <MemberPanel
              action={action}
              isHost={isHost}
              members={room.members}
              onRemove={handleRemoveMember}
            />

            {isHost && isOpen && (
              <section className="sticky top-24 rounded-3xl border border-[#bce4df] bg-[#effaf8] p-5 shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#008b84]">
                  Smart Consensus
                </p>
                <h2 className="mt-2 text-xl font-black">Sẵn sàng chốt?</h2>
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <p className="flex items-center justify-between">
                    Thành viên <strong>{room.members.length} người</strong>
                  </p>
                  <p className="flex items-center justify-between">
                    Đã bình chọn <strong>{votingMemberCount} người</strong>
                  </p>
                  <p className="flex items-center justify-between">
                    Ngưỡng chốt 60% <strong>{requiredVoters} người</strong>
                  </p>
                  <p className="flex items-center justify-between">
                    Điểm được ủng hộ <strong>{endorsedCandidateCount} điểm</strong>
                  </p>
                  <p className="flex items-center justify-between">
                    Phiên dữ liệu <strong>v{room.version}</strong>
                  </p>
                </div>
                <button
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#006b68] px-4 py-3.5 font-extrabold text-white shadow-lg shadow-[#006b68]/20 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={
                    action === 'finalize'
                    || room.members.length < 2
                    || votingMemberCount < requiredVoters
                    || endorsedCandidateCount < 1
                  }
                  onClick={() => void handleFinalize()}
                  type="button"
                >
                  <span className={`material-symbols-outlined ${action === 'finalize' ? 'animate-spin' : ''}`}>
                    {action === 'finalize' ? 'progress_activity' : 'auto_awesome'}
                  </span>
                  {action === 'finalize' ? 'Đang kiểm tra vé...' : 'Chốt lịch trình chung'}
                </button>
                {(room.members.length < 2 || votingMemberCount < requiredVoters) && (
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    {room.members.length < 2
                      ? 'Cần ít nhất 2 thành viên trong phòng trước khi chốt.'
                      : `Cần tối thiểu ${requiredVoters}/${room.members.length} thành viên đã vote để đạt ngưỡng đồng thuận 60%.`}
                  </p>
                )}
                {endorsedCandidateCount < 1 && votingMemberCount >= requiredVoters && (
                  <p className="mt-3 text-xs leading-5 text-amber-700">
                    Cần ít nhất một địa điểm được chọn “Phù hợp” hoặc “Rất muốn đi”
                    và không bị phủ quyết.
                  </p>
                )}
              </section>
            )}
          </aside>
        </div>
      </main>
      <Footer />
    </>
  )
}

function MemberAvatar({ member, size = 'h-8 w-8' }) {
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full ${avatarClass[member.avatarKey] || avatarClass.teal} text-xs font-black text-white`}>
      {member.displayName?.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

function CandidateCard({
  busy,
  candidate,
  disabled,
  members,
  myVote,
  onVote,
  votes,
}) {
  const snapshot = candidate.snapshot || {}
  const [imageFailed, setImageFailed] = useState(false)
  const memberById = new Map(members.map((member) => [member.id, member]))
  const voteCounts = Object.fromEntries(
    voteOptions.map((option) => [
      option.value,
      votes.filter((vote) => vote.value === option.value).length,
    ]),
  )

  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative h-48 overflow-hidden bg-gradient-to-br from-[#dff7f3] to-[#b8e5e1]">
        {snapshot.imageUrl && !imageFailed ? (
          <img
            alt={snapshot.title}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImageFailed(true)}
            src={snapshot.imageUrl}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center material-symbols-outlined text-6xl text-[#008b84]/35">
            landscape
          </span>
        )}
        <div className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1.5 text-xs font-black text-[#173234] shadow-sm">
          ⭐ {Number(snapshot.rating || 0).toFixed(1)}
          {snapshot.totalReviews > 0 ? ` · ${snapshot.totalReviews}` : ''}
        </div>
        {voteCounts.VETO > 0 && (
          <div className="absolute right-3 top-3 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-black text-white shadow-sm">
            {voteCounts.VETO} phủ quyết
          </div>
        )}
      </div>

      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">{snapshot.title}</h3>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {[snapshot.district, snapshot.city].filter(Boolean).join(', ')}
            </p>
          </div>
          <strong className="shrink-0 text-sm text-[#006b68]">
            {snapshot.minPrice != null ? `Từ ${formatCurrency(snapshot.minPrice)}` : 'Xem giá'}
          </strong>
        </div>
        <p className="mt-3 line-clamp-2 min-h-[40px] text-sm leading-5 text-slate-600">
          {snapshot.description || 'Trải nghiệm đang được bán trên VietTicket.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(snapshot.categories || []).slice(0, 3).map((category) => (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600" key={category}>
              {category}
            </span>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-[#eef8f7] px-3 py-2 text-[11px] font-semibold text-[#356466]">
          <span className="inline-flex items-center gap-1">
            <span className="material-symbols-outlined text-base">event_available</span>
            {snapshot.availabilityDate
              ? `Tồn lúc mở phòng: ${formatDate(snapshot.availabilityDate)}`
              : 'Sẽ kiểm tra tồn khi chốt'}
          </span>
          {snapshot.maxAvailableTickets != null && (
            <span>Tối đa {snapshot.maxAvailableTickets} vé/loại</span>
          )}
        </div>

        <div className="mt-4 flex min-h-8 items-center gap-1">
          {votes.slice(0, 8).map((vote) => {
            const member = memberById.get(vote.memberId)
            return member ? (
              <span
                className={`-ml-1 first:ml-0 ${vote.value === 'VETO' ? 'ring-2 ring-rose-400' : ''} rounded-full`}
                key={vote.id}
                title={`${member.displayName}: ${voteOptions.find((option) => option.value === vote.value)?.label}`}
              >
                <MemberAvatar member={member} size="h-7 w-7" />
              </span>
            ) : null
          })}
          {votes.length === 0 && (
            <span className="text-xs font-semibold text-slate-400">Chưa có bình chọn</span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4">
          {voteOptions.map((option) => {
            const selected = myVote === option.value
            return (
              <button
                aria-pressed={selected}
                className={`flex min-h-[58px] flex-col items-center justify-center rounded-xl border px-1 py-2 text-[11px] font-extrabold transition ${
                  selected
                    ? option.active
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                }`}
                disabled={disabled || busy}
                key={option.value}
                onClick={() => onVote(candidate.id, option.value)}
                type="button"
              >
                <span className={`material-symbols-outlined text-xl ${busy ? 'animate-pulse' : ''}`}>
                  {option.icon}
                </span>
                <span>{option.label}</span>
                <span className="mt-0.5 text-[10px] opacity-70">{voteCounts[option.value]}</span>
              </button>
            )
          })}
        </div>
      </div>
    </article>
  )
}

function InvitePanel({ inviteUrl, loading, onCopy, onRotate, room }) {
  if (!inviteUrl) {
    return (
      <section className="rounded-3xl border border-dashed border-[#8fcfc9] bg-white p-5 text-center">
        <span className="material-symbols-outlined text-5xl text-[#008b84]">qr_code_2</span>
        <h2 className="mt-3 text-lg font-black">Mời bạn đồng hành</h2>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Mã mời chỉ có quyền tham gia đúng phòng này.
        </p>
        <button
          className="mt-4 w-full rounded-xl bg-[#006b68] px-4 py-3 text-sm font-extrabold text-white"
          disabled={loading}
          onClick={() => void onRotate()}
          type="button"
        >
          Tạo QR mời
        </button>
      </section>
    )
  }

  return (
    <section className="rounded-3xl border border-[#bce4df] bg-white p-5 text-center shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-[#008b84]">
        Quét để tham gia
      </p>
      <div className="mx-auto mt-4 w-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <QRCodeSVG
          bgColor="#ffffff"
          fgColor="#064b50"
          level="M"
          marginSize={1}
          size={176}
          value={inviteUrl}
        />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Tối đa {room.maxMembers} người · Link hết hạn {formatDateTime(room.inviteExpiresAt)}
      </p>
      <button
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-[#79c9c2] bg-[#effaf8] px-4 py-3 text-sm font-extrabold text-[#006b68]"
        onClick={() => void onCopy()}
        type="button"
      >
        <span className="material-symbols-outlined text-lg">content_copy</span>
        Sao chép link
      </button>
    </section>
  )
}

function PreferencePanel({ disabled, member, onSaved, partyToken, roomId }) {
  const [budgetCap, setBudgetCap] = useState(Number(member?.budgetCap || 500000))
  const [preferences, setPreferences] = useState(member?.preferences?.categories || [])
  const [saving, setSaving] = useState(false)

  const togglePreference = (value) => {
    if (disabled) return
    setPreferences((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value].slice(0, 5),
    )
  }

  const save = async () => {
    if (saving || disabled) return
    setSaving(true)
    try {
      const response = await updatePartyMember(
        roomId,
        {
          budgetCap: Number(budgetCap),
          preferences: { categories: preferences },
        },
        partyToken,
      )
      onSaved(response?.data)
      toast.success('Đã cập nhật gu và mức chi của bạn.')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <MemberAvatar member={member} size="h-10 w-10" />
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-[#008b84]">Gu của bạn</p>
          <h2 className="font-black">{member.displayName}</h2>
        </div>
      </div>
      <label className="mt-5 block">
        <span className="flex items-center justify-between text-xs font-bold text-slate-600">
          Mức chi thoải mái
          <strong className="text-[#006b68]">{formatCurrency(budgetCap)}</strong>
        </span>
        <input
          className="mt-2 w-full accent-[#006b68]"
          disabled={disabled}
          max="5000000"
          min="50000"
          onChange={(event) => setBudgetCap(Number(event.target.value))}
          step="50000"
          type="range"
          value={budgetCap}
        />
      </label>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {CATEGORY_OPTIONS.map((option) => {
          const selected = preferences.includes(option.value)
          return (
            <button
              aria-pressed={selected}
              className={`rounded-full border px-2.5 py-1.5 text-[11px] font-bold ${
                selected
                  ? 'border-[#68c3bb] bg-[#e5f8f5] text-[#005b59]'
                  : 'border-slate-200 text-slate-500'
              }`}
              disabled={disabled}
              key={option.value}
              onClick={() => togglePreference(option.value)}
              type="button"
            >
              {option.label}
            </button>
          )
        })}
      </div>
      {!disabled && (
        <button
          className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-50"
          disabled={saving}
          onClick={() => void save()}
          type="button"
        >
          {saving ? 'Đang lưu...' : 'Lưu gu của tôi'}
        </button>
      )}
    </section>
  )
}

function MemberPanel({ action, isHost, members, onRemove }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-[#008b84]">
        Thành viên
      </p>
      <div className="mt-4 space-y-3">
        {members.map((member) => (
          <div className="flex items-center gap-3" key={member.id}>
            <MemberAvatar member={member} size="h-9 w-9" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold">
                {member.displayName}
                {member.role === 'HOST' && (
                  <span className="ml-1 text-xs text-[#008b84]">Host</span>
                )}
              </p>
              <p className="text-[11px] text-slate-500">
                {member.budgetCap ? `Thoải mái ${formatCurrency(member.budgetCap)}` : 'Chưa đặt mức chi'}
              </p>
            </div>
            {isHost && member.role !== 'HOST' && (
              <button
                className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                disabled={action === `remove-${member.id}`}
                onClick={() => void onRemove(member)}
                type="button"
              >
                <span className="material-symbols-outlined text-lg">person_remove</span>
                <span className="sr-only">Xóa {member.displayName}</span>
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function DecisionPanel({
  isHost,
  latestDecision,
  members,
  onActivateLive,
  onReopen,
  onStartBooking,
  plan,
  room,
  runningAction,
}) {
  const metrics = latestDecision?.metrics || {}
  const activities = (plan.days || []).flatMap((day) => day.activities || [])
  const satisfaction = metrics.satisfactionByMember || {}
  const candidateTitles = new Map(
    room.candidates.map((candidate) => [
      candidate.attractionId,
      candidate.snapshot?.title || candidate.attractionId,
    ]),
  )
  const notScheduledTitles = (plan.partySync?.notScheduledAttractionIds || [])
    .map((attractionId) => candidateTitles.get(attractionId))
    .filter(Boolean)

  return (
    <div className="space-y-7">
      <section className="overflow-hidden rounded-3xl border border-[#9edbd5] bg-white shadow-sm">
        <div className="bg-gradient-to-r from-[#006b68] to-[#088d86] p-6 text-white md:p-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#a7fff4]">
            Kết quả Smart Consensus
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="flex items-baseline gap-2">
                <strong className="text-6xl font-black">{Number(latestDecision.consensusScore || 0)}%</strong>
                <span className="text-sm font-bold text-white/70">đồng thuận</span>
              </div>
              <p className="mt-3 max-w-xl text-sm leading-6 text-white/75">
                Tính từ các địa điểm thực sự được xếp lịch sau khi kiểm tra lại vé,
                khung giờ và ngân sách.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/10 px-4 py-3">
                <span className="block text-xs text-white/60">Hài lòng thấp nhất</span>
                <strong className="text-xl">{Number(latestDecision.minimumSatisfaction || 0)}%</strong>
              </div>
              <div className="rounded-xl bg-white/10 px-4 py-3">
                <span className="block text-xs text-white/60">Thoải mái ngân sách</span>
                <strong className="text-xl">
                  {metrics.budgetComfortCount || 0}/{metrics.declaredBudgetCount || 0}
                </strong>
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-4 p-6 sm:grid-cols-3">
          <MetricCard icon="payments" label="Tổng vé dự kiến" value={formatCurrency(plan.estimatedCost?.total)} />
          <MetricCard icon="person" label="Bình quân mỗi người" value={formatCurrency(plan.estimatedCost?.perPerson)} />
          <MetricCard icon="verified" label="Kiểm tra catalog" value={formatDateTime(plan.partySync?.catalogCheckedAt)} />
        </div>
      </section>

      {(plan.generationWarning || notScheduledTitles.length > 0) && (
        <section
          className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm"
          role="status"
        >
          <div className="flex gap-3">
            <span className="material-symbols-outlined text-amber-600">info</span>
            <div>
              <h2 className="font-black">Điều hệ thống đã cân nhắc khi xếp lịch</h2>
              {plan.generationWarning && (
                <p className="mt-2 text-sm leading-6">{plan.generationWarning}</p>
              )}
              {notScheduledTitles.length > 0 && (
                <p className="mt-2 text-sm leading-6">
                  Chưa thể đưa vào lịch chính: <strong>{notScheduledTitles.join(', ')}</strong>.
                  Các lựa chọn này không đáp ứng đồng thời khung giờ, tuyến đi hoặc ngân sách
                  sau lần kiểm tra vé cuối.
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#008b84]">Công bằng trong nhóm</p>
            <h2 className="mt-1 text-2xl font-black">Mỗi người được đáp ứng thế nào?</h2>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
            {latestDecision.algorithmVersion}
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {members.map((member) => {
            const score = Number(satisfaction[member.id] || 0)
            return (
              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4" key={member.id}>
                <div className="flex items-center gap-3">
                  <MemberAvatar member={member} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-3 text-sm font-extrabold">
                      <span>{member.displayName}</span>
                      <span className="text-[#006b68]">{score}%</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-[#18a89f]" style={{ width: `${score}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {activities.length > 0 && (
        <AIItineraryRouteMap activities={activities} height={310} />
      )}

      <section className="space-y-5">
        {(plan.days || []).map((day, index) => (
          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7" key={day.day || index}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-[#008b84]">
                  Ngày {day.day || index + 1} · {day.visitDate || ''}
                </p>
                <h2 className="mt-1 text-xl font-black">{day.theme || 'Lịch trình tham quan'}</h2>
              </div>
              {day.routeSummary && (
                <span className="rounded-full bg-[#eef8f7] px-3 py-1.5 text-xs font-bold text-[#006b68]">
                  {day.routeSummary.totalDistanceKm || 0} km di chuyển
                </span>
              )}
            </div>
            <div className="mt-5 space-y-3">
              {(day.activities || []).map((activity, activityIndex) => (
                <div className="flex gap-4 rounded-2xl border border-slate-100 bg-slate-50 p-4" key={`${activity.attractionId}-${activityIndex}`}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#dff7f3] font-black text-[#006b68]">
                    {activityIndex + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-black">{activity.title}</h3>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                          {activity.suggestedTime} · {activity.environment === 'INDOOR' ? 'Trong nhà' : activity.environment === 'OUTDOOR' ? 'Ngoài trời' : 'Kết hợp'}
                        </p>
                      </div>
                      <strong className="text-sm text-[#006b68]">{formatCurrency(activity.estimatedCost)}</strong>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(activity.ticketItems || []).map((ticket) => (
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600" key={`${ticket.ticketId}-${ticket.ticketType}`}>
                          {ticket.quantity} × {ticket.ticketName}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>

      {isHost && room.status === 'FINALIZED' && (
        <section className="rounded-3xl border border-[#bce4df] bg-[#effaf8] p-6">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div>
              <h2 className="text-xl font-black">Lịch chung đã được lưu vào tài khoản</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Quy trình đặt hiện tại xử lý từng dòng vé riêng để giữ đúng tồn kho và
                chính sách của từng Partner; hệ thống không tuyên bố giữ toàn bộ vé trước khi reservation được tạo.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-xl border border-[#68bdb6] bg-white px-4 py-3 text-sm font-extrabold text-[#006b68] disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                disabled={
                  Boolean(room.savedItinerary?.liveTrip)
                  || Boolean(room.bookingStartedAt)
                  || runningAction === 'reopen'
                }
                onClick={() => void onReopen()}
                title={
                  room.bookingStartedAt
                    ? 'Không thể mở lại vì lịch trình đã phát sinh đơn đặt vé.'
                    : room.savedItinerary?.liveTrip
                      ? 'Không thể mở lại khi Live Trip đang hoạt động.'
                      : 'Mở lại để nhóm tiếp tục bình chọn.'
                }
                type="button"
              >
                Mở lại bình chọn
              </button>
              <button
                className="rounded-xl border border-[#68bdb6] bg-white px-4 py-3 text-sm font-extrabold text-[#006b68]"
                disabled={runningAction === 'live'}
                onClick={() => void onActivateLive()}
                type="button"
              >
                {runningAction === 'live' ? 'Đang bật Live...' : 'Bật VietTicket Live'}
              </button>
              <button
                className="rounded-xl bg-[#006b68] px-5 py-3 text-sm font-extrabold text-white shadow-lg shadow-[#006b68]/20"
                onClick={onStartBooking}
                type="button"
              >
                Bắt đầu đặt vé
              </button>
            </div>
            {room.bookingStartedAt && (
              <p className="w-full rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Lịch trình đã phát sinh đơn đặt vé nên phiên bản này được khóa để tránh lệch ngày đi, tồn vé và khoản đã thanh toán. Nhóm có thể tạo phòng mới nếu muốn đổi kế hoạch.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

function MetricCard({ icon, label, value }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <span className="material-symbols-outlined text-[#008b84]">{icon}</span>
      <span className="mt-2 block text-xs font-semibold text-slate-500">{label}</span>
      <strong className="mt-1 block text-sm">{value || '—'}</strong>
    </div>
  )
}

export default PartyRoomPage
