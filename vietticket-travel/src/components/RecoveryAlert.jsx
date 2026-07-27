import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../context/useAuth.js'
import useSocket from '../context/useSocket.js'
import { listRecoveryCases } from '../services/recoveryApi.js'
import { hasRole } from '../utils/userRoles.js'

function RecoveryAlert() {
  const { isAuthenticated, user } = useAuth()
  const socket = useSocket()
  const location = useLocation()
  const [activeCase, setActiveCase] = useState(null)
  const [dismissedId, setDismissedId] = useState(null)

  const loadActiveCase = useCallback(async () => {
    if (!isAuthenticated || !hasRole(user, 'CUSTOMER')) {
      setActiveCase(null)
      return
    }
    try {
      const cases = await listRecoveryCases('OPEN')
      setActiveCase(cases[0] || null)
    } catch {
      // The page itself retains the full error state. A background banner
      // should never interrupt navigation when the API is temporarily offline.
    }
  }, [isAuthenticated, user])

  useEffect(() => {
    const timer = window.setTimeout(() => void loadActiveCase(), 0)
    return () => window.clearTimeout(timer)
  }, [loadActiveCase])

  useEffect(() => {
    const handleCreated = (event) => {
      setDismissedId(null)
      setActiveCase({
        id: event.recoveryCaseId,
        status: event.status,
        expiresAt: event.expiresAt,
        originalBookingId: event.originalBookingId,
      })
    }
    const handleUpdated = (event) => {
      if (event.status !== 'OPEN') {
        setActiveCase((current) => (
          current?.id === event.recoveryCaseId ? null : current
        ))
      } else {
        void loadActiveCase()
      }
    }
    socket.on('RECOVERY_CASE_CREATED', handleCreated)
    socket.on('RECOVERY_CASE_UPDATED', handleUpdated)
    return () => {
      socket.off('RECOVERY_CASE_CREATED', handleCreated)
      socket.off('RECOVERY_CASE_UPDATED', handleUpdated)
    }
  }, [loadActiveCase, socket])

  if (
    !activeCase
    || dismissedId === activeCase.id
    || location.pathname.startsWith('/rescue')
  ) {
    return null
  }

  return (
    <aside
      aria-live="assertive"
      className="fixed inset-x-3 bottom-4 z-[90] mx-auto max-w-xl overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.24)] sm:left-5 sm:right-auto sm:mx-0"
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
          className="h-9 w-9 shrink-0 rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          type="button"
          onClick={() => setDismissedId(activeCase.id)}
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
