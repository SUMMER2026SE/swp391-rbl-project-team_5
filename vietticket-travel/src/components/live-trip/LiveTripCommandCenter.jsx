import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  getLiveTripCommandState,
  getLiveTripProgress,
} from '../../utils/liveTripExperience.js'

const TONE_STYLES = {
  success: {
    shell: 'border-emerald-200 bg-emerald-50',
    icon: 'bg-emerald-600 text-white',
    eyebrow: 'text-emerald-700',
    title: 'text-emerald-950',
    body: 'text-emerald-800',
    primary: 'bg-emerald-700 text-white hover:bg-emerald-800',
  },
  warning: {
    shell: 'border-amber-200 bg-amber-50',
    icon: 'bg-amber-500 text-white',
    eyebrow: 'text-amber-700',
    title: 'text-amber-950',
    body: 'text-amber-900',
    primary: 'bg-amber-700 text-white hover:bg-amber-800',
  },
  violet: {
    shell: 'border-violet-200 bg-violet-50',
    icon: 'bg-violet-700 text-white',
    eyebrow: 'text-violet-700',
    title: 'text-violet-950',
    body: 'text-violet-800',
    primary: 'bg-violet-700 text-white hover:bg-violet-800',
  },
  cyan: {
    shell: 'border-cyan-200 bg-cyan-50',
    icon: 'bg-[#006b72] text-white',
    eyebrow: 'text-cyan-700',
    title: 'text-cyan-950',
    body: 'text-cyan-900',
    primary: 'bg-[#006b72] text-white hover:bg-[#004f55]',
  },
  live: {
    shell: 'border-sky-200 bg-sky-50',
    icon: 'bg-sky-700 text-white',
    eyebrow: 'text-sky-700',
    title: 'text-sky-950',
    body: 'text-sky-900',
    primary: 'bg-sky-700 text-white hover:bg-sky-800',
  },
  neutral: {
    shell: 'border-slate-200 bg-slate-50',
    icon: 'bg-slate-700 text-white',
    eyebrow: 'text-slate-600',
    title: 'text-slate-900',
    body: 'text-slate-700',
    primary: 'bg-slate-800 text-white hover:bg-slate-900',
  },
}

function formatSyncTime(value) {
  if (!value) return 'chưa đồng bộ'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'chưa đồng bộ'
  return date.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh',
  })
}

function remainingLabel(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'Đang đối soát trạng thái'
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days} ngày ${hours} giờ`
  if (hours > 0) return `${hours} giờ ${minutes} phút`
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function Countdown({ kind, targetAt }) {
  const [now, setNow] = useState(() => Date.now())
  const target = useMemo(() => new Date(targetAt).getTime(), [targetAt])

  useEffect(() => {
    if (!Number.isFinite(target)) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [target])

  if (!Number.isFinite(target)) return null
  const label = kind === 'QUEUE_READY'
    ? 'Cửa sổ quay lại'
    : kind === 'PROPOSAL'
      ? 'Thời gian quyết định'
      : 'Bắt đầu sau'
  const remaining = remainingLabel(target - now)

  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p
        aria-label={`${label}: ${remaining}`}
        className="mt-1 font-mono text-xl font-black tabular-nums text-slate-950"
        role="timer"
      >
        {remaining}
      </p>
    </div>
  )
}

function ActionLink({ className, href, children }) {
  if (String(href || '').startsWith('/')) {
    return <Link className={className} to={href}>{children}</Link>
  }
  return <a className={className} href={href}>{children}</a>
}

function SyncBadge({ connected, lastSyncedAt, syncError, syncing }) {
  const state = syncing
    ? {
        className: 'border-sky-200 bg-sky-50 text-sky-800',
        dot: 'bg-sky-500 animate-pulse',
        label: 'Đang đồng bộ',
      }
    : connected
      ? {
          className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
          dot: 'bg-emerald-500',
          label: 'Realtime đang kết nối',
        }
      : {
          className: syncError
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'border-slate-200 bg-slate-50 text-slate-700',
          dot: syncError ? 'bg-amber-500' : 'bg-slate-400',
          label: 'Đồng bộ dự phòng 60 giây',
        }

  return (
    <div className={`inline-flex flex-wrap items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${state.className}`}>
      <span className={`h-2 w-2 rounded-full ${state.dot}`} aria-hidden="true" />
      <span>{state.label}</span>
      <span className="font-medium opacity-75">· {formatSyncTime(lastSyncedAt)}</span>
    </div>
  )
}

export default function LiveTripCommandCenter({
  analysis,
  connected,
  interactive = true,
  lastSyncedAt,
  syncError,
  syncing,
  trip,
}) {
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 15000)
    return () => window.clearInterval(timer)
  }, [])

  const command = useMemo(
    () => getLiveTripCommandState(trip, clock, { interactive }),
    [clock, interactive, trip],
  )
  const progress = useMemo(() => getLiveTripProgress(trip), [trip])
  const tone = TONE_STYLES[command.tone] || TONE_STYLES.neutral
  const stats = analysis?.stats || null

  return (
    <section
      aria-labelledby="live-command-title"
      className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_70px_-38px_rgba(0,71,77,0.5)]"
    >
      <div className="border-b border-slate-100 bg-[radial-gradient(circle_at_top_right,rgba(14,165,164,0.16),transparent_38%),linear-gradient(135deg,#ffffff,#f3fbfb)] p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#00858a]">
              AI Mission Control
            </p>
            <h2 className="mt-1 text-2xl font-black text-[#00474d]" id="live-command-title">
              Việc quan trọng nhất cần làm tiếp theo
            </h2>
          </div>
          <SyncBadge
            connected={connected}
            lastSyncedAt={lastSyncedAt}
            syncError={syncError}
            syncing={syncing}
          />
        </div>

        {syncError && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-900" role="status">
            Dữ liệu gần nhất vẫn được giữ an toàn. Đồng bộ mới chưa thành công: {syncError}
          </p>
        )}

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)]">
          <article className={`rounded-3xl border p-5 md:p-6 ${tone.shell}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <span className={`material-symbols-outlined w-fit rounded-2xl p-3 text-2xl shadow-sm ${tone.icon}`} aria-hidden="true">
                {command.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-black uppercase tracking-[0.15em] ${tone.eyebrow}`}>
                  {command.eyebrow}
                </p>
                <h3 className={`mt-1 text-2xl font-black leading-tight ${tone.title}`}>
                  {command.title}
                </h3>
                <p className={`mt-3 text-sm leading-6 ${tone.body}`}>{command.description}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ActionLink
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition ${tone.primary}`}
                    href={command.primaryHref}
                  >
                    {command.primaryLabel}
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
                  </ActionLink>
                  {command.secondaryHref && command.secondaryHref !== command.primaryHref && (
                    <ActionLink
                      className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
                      href={command.secondaryHref}
                    >
                      {command.secondaryLabel}
                    </ActionLink>
                  )}
                </div>
              </div>
              {command.targetAt && <Countdown kind={command.kind} targetAt={command.targetAt} />}
            </div>
          </article>

          <aside className="rounded-3xl border border-[#bde8e6] bg-[#00474d] p-5 text-white">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#a9e8e5]">
              Safety stack
            </p>
            <div className="mt-4 space-y-3">
              <SafetyItem
                icon="lock"
                text="Booking đã thanh toán luôn được khóa khỏi thay đổi tự động."
              />
              <SafetyItem
                icon="touch_app"
                text="Đề xuất đổi lịch chỉ áp dụng sau xác nhận của khách."
              />
              <SafetyItem
                icon="visibility"
                text="Chỉ số nhu cầu chỉ đại diện dữ liệu VietTicket quan sát được."
              />
            </div>
          </aside>
        </div>
      </div>

      <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-7">
        <div>
          <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-600">
            <span>Tiến độ hành trình</span>
            <span>{progress.completed}/{progress.total} hoạt động đã khép lại</span>
          </div>
          <div
            aria-label={`Tiến độ hành trình ${progress.percent}%`}
            aria-valuemax="100"
            aria-valuemin="0"
            aria-valuenow={progress.percent}
            className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#00858a] to-emerald-400 transition-[width] duration-500"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600 md:min-w-72">
          {stats ? (
            <>
              <strong className="text-slate-800">Lần phân tích gần nhất:</strong>{' '}
              {stats.evaluated || 0} hoạt động · {stats.atRisk || 0} rủi ro ·{' '}
              {stats.proposalsCreated || 0} đề xuất mới · {stats.aiPredictionsUsed || 0} tín hiệu ML hợp lệ.
            </>
          ) : (
            <>
              <strong className="text-slate-800">Giải thích quyết định:</strong>{' '}
              xem nhật ký phía dưới để biết tín hiệu và ràng buộc đã dẫn tới mỗi thay đổi.
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function SafetyItem({ icon, text }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/10 p-3">
      <span className="material-symbols-outlined text-[19px] text-[#a9e8e5]" aria-hidden="true">{icon}</span>
      <p className="text-xs font-semibold leading-5 text-[#e5f8f7]">{text}</p>
    </div>
  )
}
