import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../context/useAuth.js'
import useSocket from '../context/useSocket.js'
import { listRecoveryCases } from '../services/recoveryApi.js'
import { sortRecoveryCases } from '../utils/recoveryPresentation.js'
import { hasRole } from '../utils/userRoles.js'

function RecoveryAlert() {
  const { isAuthenticated, user } = useAuth()
  const socket = useSocket()
  const location = useLocation()
  const [openCases, setOpenCases] = useState([])
  const [dismissedIds, setDismissedIds] = useState(() => new Set())
  const refreshVersion = useRef(0)
  const retryTimer = useRef(null)
  const optimisticCases = useRef(new Map())

  const loadActiveCases = useCallback(async () => {
    if (!isAuthenticated || !hasRole(user, 'CUSTOMER')) {
      refreshVersion.current += 1
      optimisticCases.current.clear()
      setOpenCases([])
      setDismissedIds(new Set())
      return
    }
    // Đánh số cho CHÍNH lần gọi này, không chỉ đọc số hiện tại. Focus và
    // visibilitychange cùng bắn khi khách quay lại tab nên hai request luôn
    // chạy song song; nếu chỉ đọc số, cả hai đều qua được cửa và response nào
    // về sau sẽ ghi đè — kể cả khi nó là response cũ hơn.
    refreshVersion.current += 1
    const requestVersion = refreshVersion.current
    try {
      const cases = await listRecoveryCases('OPEN')
      const orderedCases = sortRecoveryCases(
        cases.filter((recoveryCase) => recoveryCase.status === 'OPEN'),
      )
      // Đã có request mới hơn (hoặc một sự kiện socket) sau khi request này
      // rời đi: kết quả này đã cũ, bỏ qua. Lần gọi mới nhất mới được ghi.
      if (requestVersion !== refreshVersion.current) return

      const now = Date.now()
      for (const [id, entry] of optimisticCases.current.entries()) {
        const expired = now - entry.createdAt > 10000
        const confirmed = orderedCases.some((item) => item.id === id)
        if (expired || confirmed) {
          optimisticCases.current.delete(id)
        } else {
          orderedCases.push(entry.case)
        }
      }
      const finalCases = sortRecoveryCases(orderedCases)
      setOpenCases(finalCases)
      setDismissedIds((current) => new Set(
        [...current].filter((id) => finalCases.some((item) => item.id === id)),
      ))
    } catch {
      // The page itself retains the full error state. A background banner
      // should never interrupt navigation when the API is temporarily offline.
    }
  }, [isAuthenticated, user])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadActiveCases(), 0)
    return () => window.clearTimeout(timer)
  }, [loadActiveCases])

  useEffect(() => {
    if (!isAuthenticated || !hasRole(user, 'CUSTOMER')) return undefined
    const refresh = () => void loadActiveCases()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const interval = window.setInterval(refresh, 30000)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [isAuthenticated, loadActiveCases, user])

  useEffect(() => {
    const scheduleRefresh = () => {
      if (retryTimer.current) window.clearTimeout(retryTimer.current)
      retryTimer.current = window.setTimeout(() => {
        retryTimer.current = null
        void loadActiveCases()
      }, 300)
    }
    const handleCreated = (event) => {
      refreshVersion.current += 1
      const optimisticCase = {
        id: event.recoveryCaseId,
        status: event.status,
        expiresAt: event.expiresAt,
        originalBookingId: event.originalBookingId,
      }
      optimisticCases.current.set(event.recoveryCaseId, {
        case: optimisticCase,
        createdAt: Date.now(),
      })
      setDismissedIds((current) => {
        const next = new Set(current)
        next.delete(event.recoveryCaseId)
        return next
      })
      setOpenCases((current) => sortRecoveryCases([
        ...current.filter((item) => item.id !== event.recoveryCaseId),
        optimisticCase,
      ]))
      scheduleRefresh()
    }
    const handleUpdated = (event) => {
      refreshVersion.current += 1
      optimisticCases.current.delete(event.recoveryCaseId)
      if (event.status !== 'OPEN') {
        setOpenCases((current) => (
          current.filter((item) => item.id !== event.recoveryCaseId)
        ))
      } else {
        setDismissedIds((current) => {
          const next = new Set(current)
          next.delete(event.recoveryCaseId)
          return next
        })
      }
      scheduleRefresh()
    }
    socket.on('RECOVERY_CASE_CREATED', handleCreated)
    socket.on('RECOVERY_CASE_UPDATED', handleUpdated)
    return () => {
      if (retryTimer.current) {
        window.clearTimeout(retryTimer.current)
        retryTimer.current = null
      }
      socket.off('RECOVERY_CASE_CREATED', handleCreated)
      socket.off('RECOVERY_CASE_UPDATED', handleUpdated)
    }
  }, [loadActiveCases, socket])

  const visibleCases = openCases.filter((item) => !dismissedIds.has(item.id))
  const activeCase = visibleCases[0] || null

  if (
    !activeCase
    || location.pathname.startsWith('/rescue')
  ) {
    return null
  }

  return (
    <aside
      aria-live="assertive"
      aria-label="Cảnh báo VietTicket Rescue"
      className="fixed inset-x-3 top-16 z-[90] mx-auto max-w-xl overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.24)] sm:bottom-5 sm:left-5 sm:right-auto sm:top-auto sm:mx-0"
    >
      <div className="h-1.5 bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500" />
      <div className="flex gap-3 p-4 sm:p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <span className="material-symbols-outlined" aria-hidden="true">shield</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-amber-700">
            VietTicket Rescue
          </p>
          <h2 className="mt-1 text-base font-extrabold text-slate-900">
            Vé bị hủy, nhưng kế hoạch vẫn có thể được cứu
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Chúng tôi đã tìm vé thay thế còn chỗ. Bạn không phải thanh toán lại
            và vẫn luôn có quyền nhận hoàn 100%.
          </p>
          {visibleCases.length > 1 && (
            <p className="mt-2 text-xs font-bold text-rose-700">
              Còn {visibleCases.length} booking cần bạn xem xét.
            </p>
          )}
          <Link
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#07545b] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#043f45]"
            to={`/rescue/${activeCase.id}`}
          >
            Xem phương án
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
              arrow_forward
            </span>
          </Link>
        </div>
        <button
          aria-label="Ẩn thông báo cứu chuyến"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          type="button"
          onClick={() => setDismissedIds((current) => new Set(current).add(activeCase.id))}
        >
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            close
          </span>
        </button>
      </div>
    </aside>
  )
}

export default RecoveryAlert
