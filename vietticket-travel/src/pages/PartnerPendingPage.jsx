import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/useAuth.js'

const NAV_ITEMS = [
  { icon: 'dashboard', label: 'Dashboard' },
  { icon: 'local_activity', label: 'Điểm tham quan' },
  { icon: 'confirmation_number', label: 'Đặt vé' },
  { icon: 'assessment', label: 'Báo cáo' },
  { icon: 'settings', label: 'Cài đặt' },
]

function PartnerPendingPage() {
  const navigate = useNavigate()
  const { user } = useAuth()

  useEffect(() => {
    document.title = 'Hồ sơ đang xét duyệt | VietTicket B2B'
  }, [])

  return (
    <div className="bg-[#f2f4f5] text-[#191c1d] h-screen flex overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* Sidebar — locked state */}
      <nav className="hidden md:flex flex-col border-r border-[#bec8ca]/20 bg-white shadow-md w-64 pt-20 h-full fixed left-0 top-0 z-10">
        {/* Header */}
        <div className="px-6 mb-8 opacity-60">
          <div className="w-12 h-12 rounded-full bg-[#e6e8e9] overflow-hidden mb-4 border border-[#bec8ca]/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-[#3f484a]">store</span>
          </div>
          <h2 className="font-semibold text-base text-[#00474d] truncate">
            {user?.fullName || 'Đối tác VietTicket'}
          </h2>
          <p className="text-xs text-[#3f484a] mt-1">Partner Portal</p>
        </div>

        {/* Nav items — disabled */}
        <div className="flex-1 overflow-y-auto px-2 opacity-50 cursor-not-allowed pointer-events-none">
          <div className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <div
                key={item.icon}
                className="flex items-center gap-3 text-[#3f484a] mx-2 my-1 px-4 py-3 rounded-lg"
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                <span className="text-base">{item.label}</span>
              </div>
            ))}
          </div>

          <div className="px-4 mt-8">
            <button
              disabled
              className="w-full bg-[#bec8ca] text-[#3f484a] text-sm font-medium py-3 rounded-lg flex items-center justify-center gap-2 cursor-not-allowed"
            >
              <span className="material-symbols-outlined">add</span>
              Thêm điểm mới
            </button>
          </div>
        </div>

        {/* Footer nav — disabled */}
        <div className="p-4 border-t border-[#bec8ca]/20 opacity-50 cursor-not-allowed pointer-events-none">
          <div className="flex items-center gap-3 text-[#3f484a] mx-2 my-1 px-4 py-2 rounded-lg">
            <span className="material-symbols-outlined">contact_support</span>
            <span className="text-base">Hỗ trợ</span>
          </div>
          <div className="flex items-center gap-3 text-[#3f484a] mx-2 my-1 px-4 py-2 rounded-lg">
            <span className="material-symbols-outlined">logout</span>
            <span className="text-base">Đăng xuất</span>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 flex flex-col items-center justify-center p-5 md:p-16 overflow-y-auto w-full relative">
        {/* Background decorative gradients */}
        <div className="absolute inset-0 pointer-events-none -z-10"
          style={{ background: 'radial-gradient(ellipse at top right, rgba(0,71,77,0.05) 0%, transparent 60%)' }}
        />
        <div className="absolute inset-0 pointer-events-none -z-10"
          style={{ background: 'radial-gradient(ellipse at bottom left, rgba(0,98,157,0.05) 0%, transparent 60%)' }}
        />

        {/* Pending Card */}
        <div className="max-w-[720px] w-full bg-white rounded-2xl shadow-[0px_8px_30px_rgba(0,40,50,0.06)] border border-[#bec8ca]/10 p-8 md:p-12 flex flex-col items-center text-center relative overflow-hidden">

          {/* Icon */}
          <div className="w-24 h-24 rounded-full bg-[#006068]/10 flex items-center justify-center mb-6 relative">
            <div
              className="absolute inset-0 rounded-full border-2 border-dashed border-[#00474d] opacity-50"
              style={{ animation: 'spin 20s linear infinite' }}
            />
            <span
              className="material-symbols-outlined text-[48px] text-[#00474d]"
              style={{ fontVariationSettings: "'FILL' 0" }}
            >
              hourglass_empty
            </span>
          </div>

          {/* Title & Description */}
          <h1 className="text-2xl md:text-3xl font-semibold text-[#191c1d] mb-4">
            Hồ sơ của bạn đang được xét duyệt
          </h1>
          <p className="text-base text-[#3f484a] max-w-lg mb-12 leading-relaxed">
            Cảm ơn bạn đã hoàn tất thông tin xác thực! Đội ngũ của chúng tôi đang kiểm tra các tài liệu của bạn.
            Quá trình này thường mất từ <strong>24–48 giờ làm việc</strong>. Chúng tôi sẽ thông báo cho bạn qua
            email ngay khi tài khoản được kích hoạt.
          </p>

          {/* Progress Stepper */}
          <div className="w-full px-2 md:px-8 mb-12">
            <div className="relative flex justify-between">
              {/* Background line */}
              <div className="absolute top-4 left-0 w-full h-1 bg-[#e6e8e9] rounded-full -z-10" />
              {/* Active progress line — 66% = 2 of 3 gaps done */}
              <div className="absolute top-4 left-0 w-[66%] h-1 bg-[#00474d] rounded-full -z-10 transition-all duration-1000" />

              {/* Step 1: Completed */}
              <StepItem
                icon="check"
                label="Tạo tài khoản"
                state="done"
              />
              {/* Step 2: Completed */}
              <StepItem
                icon="check"
                label="Gửi hồ sơ KYC"
                state="done"
              />
              {/* Step 3: Active / Pulsing */}
              <StepItem
                icon="pending"
                label="Đang xét duyệt"
                state="active"
              />
              {/* Step 4: Locked */}
              <StepItem
                icon="lock"
                label="Kích hoạt"
                state="pending"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center w-full">
            <a
              href="mailto:partners@vietticket.com"
              className="text-sm font-medium px-6 py-3 rounded-lg border border-[#6f797a] text-[#00474d] hover:bg-[#006068]/10 transition-colors duration-200 flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">support_agent</span>
              Liên hệ hỗ trợ
            </a>
            <Link
              to="/"
              className="text-sm font-medium px-6 py-3 rounded-lg text-[#00474d] hover:bg-[#e6e8e9] transition-colors duration-200 flex items-center justify-center"
            >
              Quay lại Trang chủ
            </Link>
          </div>
        </div>

        {/* Footer note */}
        <div className="mt-8 text-center">
          <p className="text-xs text-[#bec8ca]">
            Cần hỗ trợ khẩn cấp? Gửi email tới{' '}
            <a className="text-[#00474d] hover:underline" href="mailto:partners@vietticket.com">
              partners@vietticket.com
            </a>
          </p>
        </div>
      </main>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse-ring {
          0%   { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0,96,104,0.7); }
          70%  { transform: scale(1);    box-shadow: 0 0 0 10px rgba(0,96,104,0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(0,96,104,0); }
        }
        .pulse-ring { animation: pulse-ring 2s cubic-bezier(0.215,0.61,0.355,1) infinite; }
      `}</style>
    </div>
  )
}

function StepItem({ icon, label, state }) {
  const stateStyles = {
    done: {
      circle: 'bg-[#00474d] text-white shadow-sm',
      label: 'text-[#191c1d]',
      animate: '',
    },
    active: {
      circle: 'bg-[#006068]/20 text-[#00474d] border-2 border-[#00474d] pulse-ring',
      label: 'text-[#00474d] font-bold',
      animate: 'animate-pulse',
    },
    pending: {
      circle: 'bg-[#e6e8e9] text-[#6f797a] border-2 border-[#e6e8e9]',
      label: 'text-[#6f797a]',
      animate: '',
    },
  }

  const s = stateStyles[state]

  return (
    <div className="flex flex-col items-center gap-3 bg-white px-1">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${s.circle}`}>
        <span className={`material-symbols-outlined text-[18px] ${s.animate}`}>{icon}</span>
      </div>
      <span className={`text-xs hidden md:block ${s.label}`}>{label}</span>
    </div>
  )
}

export default PartnerPendingPage
