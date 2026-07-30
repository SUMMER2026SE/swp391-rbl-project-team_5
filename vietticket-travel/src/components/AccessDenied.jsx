import { useEffect } from 'react'
import { Link } from 'react-router'
import { hasRole } from '../utils/userRoles.js'

function getPortalDestination(user) {
  if (hasRole(user, 'ADMIN')) {
    return { to: '/admin', label: 'Về trang quản trị' }
  }
  if (hasRole(user, 'STAFF')) {
    return user?.employerPartnerId
      ? { to: '/staff/checkin', label: 'Về cổng soát vé' }
      : { to: '/staff/tickets', label: 'Về cổng nhân viên' }
  }
  if (hasRole(user, 'PARTNER')) {
    return { to: '/partner/dashboard', label: 'Về trang đối tác' }
  }
  return { to: '/', label: 'Về trang chủ' }
}

export default function AccessDenied({
  user,
  description = 'Tài khoản hiện tại không có quyền sử dụng chức năng này.',
}) {
  const destination = getPortalDestination(user)

  useEffect(() => {
    document.title = 'Không có quyền truy cập | VietTicket'
  }, [])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f7f7] px-5 py-12">
      <section
        className="w-full max-w-lg rounded-3xl border border-[#d7e2e3] bg-white p-8 text-center shadow-[0_20px_60px_rgba(0,45,50,0.12)]"
        aria-labelledby="access-denied-title"
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#ffedea] text-[#ba1a1a]">
          <span className="material-symbols-outlined text-[34px]" aria-hidden="true">
            lock
          </span>
        </div>
        <p className="mt-5 text-sm font-bold uppercase tracking-[0.14em] text-[#006068]">
          Quyền truy cập
        </p>
        <h1 id="access-denied-title" className="mt-2 text-2xl font-bold text-[#172021]">
          Bạn không thể mở trang này
        </h1>
        <p className="mt-3 leading-7 text-[#526163]">{description}</p>
        <p className="mt-2 text-sm text-[#6f797a]">
          Nếu đây là nhiệm vụ được giao, hãy liên hệ quản trị viên hoặc trưởng ca để được cấp đúng quyền.
        </p>
        <Link
          to={destination.to}
          className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full bg-[#006068] px-6 font-bold text-white transition hover:bg-[#00474d]"
        >
          {destination.label}
        </Link>
      </section>
    </main>
  )
}
