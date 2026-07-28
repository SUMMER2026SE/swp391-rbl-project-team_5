import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import useSocket from '../context/useSocket.js'
import { getLiveOperationAlert } from '../utils/liveOperationsAlerts.js'

function getNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return window.Notification.permission
}

function showBackgroundNotification(alert) {
  if (
    typeof window === 'undefined'
    || !('Notification' in window)
    || window.Notification.permission !== 'granted'
    || document.visibilityState === 'visible'
  ) return

  try {
    const notification = new window.Notification(alert.title, {
      body: alert.message,
      tag: alert.tag,
      renotify: true,
    })
    notification.onclick = () => {
      window.focus()
      window.location.assign(alert.href)
      notification.close()
    }
  } catch {
    // Toast and durable Live Trip events remain the fallback when the browser
    // blocks a native notification despite a previously granted permission.
  }
}

export default function LiveOperationsAlert() {
  const socket = useSocket()

  useEffect(() => {
    function handleLiveOperation(payload) {
      const alert = getLiveOperationAlert(payload)
      if (!alert) return
      const notify = toast[alert.toastType] || toast.info
      notify(`${alert.title}. ${alert.message}`, {
        autoClose: alert.urgent ? 8000 : 4000,
        onClick: () => window.location.assign(alert.href),
      })
      showBackgroundNotification(alert)
    }

    socket.on('LIVE_TRIP_UPDATED', handleLiveOperation)
    return () => socket.off('LIVE_TRIP_UPDATED', handleLiveOperation)
  }, [socket])

  return null
}

export function LiveNotificationPermissionControl() {
  const [permission, setPermission] = useState(getNotificationPermission)

  if (permission === 'unsupported') {
    return (
      <span className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-white/80">
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">notifications_off</span>
        Trình duyệt chưa hỗ trợ cảnh báo nền
      </span>
    )
  }

  if (permission === 'granted') {
    return (
      <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-200/40 bg-emerald-300/20 px-4 py-2 text-xs font-black text-white">
        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">notifications_active</span>
        Đã bật cảnh báo khi tab nền
      </span>
    )
  }

  return (
    <button
      className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-2 text-xs font-bold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
      disabled={permission === 'denied'}
      onClick={async () => {
        try {
          const nextPermission = await window.Notification.requestPermission()
          setPermission(nextPermission)
          if (nextPermission === 'granted') {
            toast.success('Đã bật cảnh báo SmartQueue khi tab còn mở ở nền.')
          } else if (nextPermission === 'denied') {
            toast.warning('Trình duyệt đã chặn thông báo. Bạn có thể bật lại trong cài đặt website.')
          }
        } catch {
          setPermission('denied')
          toast.warning('Không thể xin quyền thông báo trên thiết bị này. Live Trip vẫn giữ cảnh báo realtime trong tab.')
        }
      }}
      type="button"
    >
      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">add_alert</span>
      {permission === 'denied' ? 'Thông báo đang bị chặn' : 'Bật cảnh báo tab nền'}
    </button>
  )
}
