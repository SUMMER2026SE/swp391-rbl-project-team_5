import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import { useAuth } from '../context/useAuth.js'
import { hasRole } from '../utils/userRoles.js'
import heroImage from '../assets/halong_bay.webp'
import * as partnerApi from '../services/partnerApi.js'
import {
  validateEmail,
  validateFullName,
  validatePassword,
  getPasswordStrength,
} from '../utils/formValidators.js'

const benefits = [
  { icon: 'language', text: 'Tiếp cận khách hàng toàn cầu' },
  { icon: 'trending_up', text: 'Tăng doanh số bán vé trực tiếp' },
  { icon: 'dashboard', text: 'Quản lý đặt vé thời gian thực' },
  { icon: 'verified_user', text: 'Thanh toán bảo mật' },
  { icon: 'headset_mic', text: 'Hỗ trợ đối tác tận tâm' },
]

const strengthBarConfig = {
  weak: { width: '33%', bg: 'bg-[#ba1a1a]', textColor: 'text-[#ba1a1a]', label: 'Yếu' },
  medium: { width: '66%', bg: 'bg-[#ffba20]', textColor: 'text-[#725000]', label: 'Trung bình' },
  strong: { width: '100%', bg: 'bg-[#10B981]', textColor: 'text-[#10B981]', label: 'Mạnh' },
  empty: { width: '0%', bg: 'bg-[#e1e3e4]', textColor: 'text-[#6f797a]', label: '' },
}

function PartnerRegisterPage() {
  const navigate = useNavigate()
  const { isAuthenticated, isAuthLoading, register, user } = useAuth()

  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [touched, setTouched] = useState({})
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    acceptedTerms: false,
  })

  const errors = useMemo(
    () => ({
      fullName: validateFullName(form.fullName),
      email: validateEmail(form.email),
      password: validatePassword(form.password),
      confirmPassword: !form.confirmPassword
        ? 'Vui lòng xác nhận mật khẩu.'
        : form.confirmPassword !== form.password
          ? 'Mật khẩu xác nhận không khớp.'
          : '',
      acceptedTerms: form.acceptedTerms ? '' : 'Vui lòng đồng ý điều khoản.',
    }),
    [form],
  )

  const isFormValid = Object.values(errors).every((e) => !e)
  const passwordStrength = getPasswordStrength(form.password)
  const passwordsMatch =
    form.confirmPassword.length > 0 && form.confirmPassword === form.password

  const strengthConfig = strengthBarConfig[passwordStrength.className] || strengthBarConfig.empty

  useEffect(() => {
    document.title = 'Đăng ký Đối tác | VietTicket Travel'
  }, [])

  useEffect(() => {
    if (isAuthLoading) return

    if (isAuthenticated) {
      if (hasRole(user, 'PARTNER')) {
        navigate('/partner/dashboard', { replace: true })
      } else {
        partnerApi
          .getMyPartner()
          .then((res) => {
            const status = res.partner?.status
            if (status === 'APPROVED') {
              navigate('/partner/dashboard', { replace: true })
            } else {
              navigate('/partner/pending', { replace: true })
            }
          })
          .catch(() => {
            navigate('/partner/kyc', { replace: true })
          })
      }
    }
  }, [isAuthenticated, isAuthLoading, user, navigate])

  const updateField = (field, value) => {
    setTouched((c) => ({ ...c, [field]: true }))
    setForm((c) => ({ ...c, [field]: value }))
  }

  const markTouched = (field) => {
    setTouched((c) => ({ ...c, [field]: true }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setTouched({
      fullName: true,
      email: true,
      password: true,
      confirmPassword: true,
      acceptedTerms: true,
    })

    if (!isFormValid) {
      toast.error('Vui lòng kiểm tra lại thông tin đăng ký.')
      return
    }

    setIsSubmitting(true)
    const result = await register({
      fullName: form.fullName,
      email: form.email,
      phone: '',
      password: form.password,
    })
    setIsSubmitting(false)

    if (!result.ok) {
      toast.error(result.message || 'Không thể tạo tài khoản đối tác.')
      return
    }

    toast.success(
      result.message || 'Vui lòng kiểm tra email để xác minh tài khoản.',
    )
    navigate('/verify-email', { state: { pendingEmail: form.email } })
  }

  return (
    <div
      className="min-h-screen flex flex-col md:flex-row antialiased"
      style={{ fontFamily: "'Inter', 'Be Vietnam Pro', sans-serif" }}
    >
      {/* ── Left Panel (Marketing) ── */}
      <div className="relative w-full md:w-1/2 min-h-[40vh] md:min-h-screen flex items-center justify-center p-5 md:p-16 overflow-hidden">
        {/* Background Image */}
        <div className="absolute inset-0 z-0">
          <img
            alt="Vịnh Hạ Long lúc bình minh với thuyền buồm truyền thống trên vùng nước xanh ngọc"
            className="w-full h-full object-cover object-center"
            src={heroImage}
          />
          {/* Gradient Overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/60 to-black/80 z-10" />
        </div>

        {/* Content */}
        <div
          className="relative z-20 max-w-lg w-full text-white"
          style={{ animation: 'fadeIn 0.6s ease-out forwards' }}
        >
          <div className="mb-8">
            <span className="inline-block px-3 py-1 rounded-full bg-white/20 text-white text-xs font-semibold backdrop-blur-md border border-white/30 mb-4">
              VietTicket Travel B2B Portal
            </span>
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight tracking-tight">
              Gia nhập mạng lưới đối tác toàn cầu
            </h1>
            <p className="text-lg text-white/90 leading-7">
              Kết nối doanh nghiệp của bạn với khách hàng đang tìm vé tham quan. Quản lý,
              bán vé và phát triển kinh doanh một cách dễ dàng.
            </p>
          </div>

          {/* Glassmorphism Benefits List */}
          <div
            className="rounded-xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.1)]"
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
            }}
          >
            <ul className="space-y-4">
              {benefits.map((benefit) => (
                <li className="flex items-center gap-3" key={benefit.icon}>
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                    <span
                      className="material-symbols-outlined text-white"
                      style={{ fontSize: '16px' }}
                      aria-hidden="true"
                    >
                      {benefit.icon}
                    </span>
                  </div>
                  <span className="text-base text-white/90">{benefit.text}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Trust Indicators Mobile */}
          <div className="mt-8 flex flex-wrap gap-4 text-sm text-white/70 md:hidden justify-center font-medium">
            <span className="flex items-center gap-1">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '16px' }}
                aria-hidden="true"
              >
                lock
              </span>
              Đăng ký bảo mật
            </span>
            <span className="flex items-center gap-1">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '16px' }}
                aria-hidden="true"
              >
                shield
              </span>
              An ninh cấp doanh nghiệp
            </span>
          </div>
        </div>
      </div>

      {/* ── Right Panel (Form) ── */}
      <div className="w-full md:w-1/2 bg-white flex items-center justify-center p-5 md:p-16 py-12">
        <div
          className="w-full max-w-[480px] bg-white rounded-2xl shadow-[0px_4px_20px_rgba(0,40,50,0.05)] p-6 md:p-8"
          style={{ animation: 'fadeIn 0.6s ease-out 0.2s forwards', opacity: 0 }}
        >
          {/* Header */}
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-semibold text-[#191c1d] mb-2 tracking-tight">
              Trở thành Đối tác
            </h2>
            <p className="text-base text-[#3f484a]">
              Tạo tài khoản đối tác để bắt đầu bán vé.
            </p>
          </div>

          {/* Form */}
          <form className="space-y-5" onSubmit={handleSubmit}>
            {/* Full Name Field */}
            <div>
              <label
                className="block text-sm font-medium text-[#191c1d] mb-1.5"
                htmlFor="partner-fullname"
              >
                Tên liên hệ
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6f797a]">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: '20px' }}
                    aria-hidden="true"
                  >
                    person
                  </span>
                </div>
                <input
                  className="block w-full pl-10 pr-3 py-3 border border-[#bec8ca] rounded-lg bg-[#f8fafb] text-[#191c1d] placeholder-[#3f484a]/50 focus:ring-2 focus:ring-[#006068] focus:border-[#006068] transition-all text-sm outline-none"
                  id="partner-fullname"
                  name="fullName"
                  placeholder="Nguyễn Văn A"
                  type="text"
                  value={form.fullName}
                  onBlur={() => markTouched('fullName')}
                  onChange={(e) => updateField('fullName', e.target.value)}
                />
              </div>
              {touched.fullName && errors.fullName ? (
                <p className="mt-1 text-xs text-[#ba1a1a]">{errors.fullName}</p>
              ) : null}
            </div>

            {/* Email Field */}
            <div>
              <label
                className="block text-sm font-medium text-[#191c1d] mb-1.5"
                htmlFor="partner-email"
              >
                Email doanh nghiệp
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6f797a]">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: '20px' }}
                    aria-hidden="true"
                  >
                    mail
                  </span>
                </div>
                <input
                  className="block w-full pl-10 pr-3 py-3 border border-[#bec8ca] rounded-lg bg-[#f8fafb] text-[#191c1d] placeholder-[#3f484a]/50 focus:ring-2 focus:ring-[#006068] focus:border-[#006068] transition-all text-sm outline-none"
                  id="partner-email"
                  name="email"
                  placeholder="name@company.com"
                  type="email"
                  value={form.email}
                  onBlur={() => markTouched('email')}
                  onChange={(e) => updateField('email', e.target.value)}
                />
              </div>
              {touched.email && errors.email ? (
                <p className="mt-1 text-xs text-[#ba1a1a]">{errors.email}</p>
              ) : null}
            </div>

            {/* Password Field */}
            <div>
              <label
                className="block text-sm font-medium text-[#191c1d] mb-1.5"
                htmlFor="partner-password"
              >
                Mật khẩu
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6f797a]">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: '20px' }}
                    aria-hidden="true"
                  >
                    lock
                  </span>
                </div>
                <input
                  className="block w-full pl-10 pr-10 py-3 border border-[#bec8ca] rounded-lg bg-[#f8fafb] text-[#191c1d] placeholder-[#3f484a]/50 focus:ring-2 focus:ring-[#006068] focus:border-[#006068] transition-all text-sm outline-none"
                  id="partner-password"
                  name="password"
                  placeholder="Nhập mật khẩu"
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onBlur={() => markTouched('password')}
                  onChange={(e) => updateField('password', e.target.value)}
                />
                <button
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#6f797a] hover:text-[#191c1d] transition-colors"
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: '20px' }}
                    aria-hidden="true"
                  >
                    {showPassword ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>

              {/* Password Strength Indicator */}
              {form.password.length > 0 ? (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-[#e1e3e4] rounded-full overflow-hidden">
                    <div
                      className={`h-full ${strengthConfig.bg} transition-all duration-300 rounded-full`}
                      style={{ width: strengthConfig.width }}
                    />
                  </div>
                  <span
                    className={`text-xs font-semibold w-16 text-right ${strengthConfig.textColor}`}
                  >
                    {strengthConfig.label}
                  </span>
                </div>
              ) : null}

              {touched.password && errors.password ? (
                <p className="mt-1 text-xs text-[#ba1a1a]">{errors.password}</p>
              ) : null}
            </div>

            {/* Confirm Password Field */}
            <div>
              <label
                className="block text-sm font-medium text-[#191c1d] mb-1.5"
                htmlFor="partner-confirm-password"
              >
                Xác nhận mật khẩu
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#6f797a]">
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: '20px' }}
                    aria-hidden="true"
                  >
                    lock
                  </span>
                </div>
                <input
                  className="block w-full pl-10 pr-10 py-3 border border-[#bec8ca] rounded-lg bg-[#f8fafb] text-[#191c1d] placeholder-[#3f484a]/50 focus:ring-2 focus:ring-[#006068] focus:border-[#006068] transition-all text-sm outline-none"
                  id="partner-confirm-password"
                  name="confirmPassword"
                  placeholder="Xác nhận mật khẩu"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={form.confirmPassword}
                  onBlur={() => markTouched('confirmPassword')}
                  onChange={(e) => updateField('confirmPassword', e.target.value)}
                />

                {/* Match Icon */}
                {passwordsMatch ? (
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#10B981] transition-opacity">
                    <span
                      className="material-symbols-outlined"
                      style={{
                        fontSize: '20px',
                        fontVariationSettings: "'FILL' 1",
                      }}
                      aria-hidden="true"
                    >
                      check_circle
                    </span>
                  </div>
                ) : form.confirmPassword.length > 0 ? (
                  <button
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#6f797a] hover:text-[#191c1d] transition-colors"
                    type="button"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    aria-label={
                      showConfirmPassword
                        ? 'Ẩn xác nhận mật khẩu'
                        : 'Hiện xác nhận mật khẩu'
                    }
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: '20px' }}
                      aria-hidden="true"
                    >
                      {showConfirmPassword ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                ) : null}
              </div>
              {touched.confirmPassword && errors.confirmPassword ? (
                <p className="mt-1 text-xs text-[#ba1a1a]">
                  {errors.confirmPassword}
                </p>
              ) : null}
            </div>

            {/* Terms */}
            <div className="flex items-start pt-2">
              <div className="flex items-center h-5">
                <input
                  className="w-4 h-4 accent-[#006068] cursor-pointer"
                  id="partner-terms"
                  name="terms"
                  type="checkbox"
                  checked={form.acceptedTerms}
                  onChange={(e) =>
                    updateField('acceptedTerms', e.target.checked)
                  }
                />
              </div>
              <div className="ml-3 text-sm">
                <label
                  className="text-base text-[#3f484a]"
                  htmlFor="partner-terms"
                >
                  Tôi đồng ý với{' '}
                  <a
                    className="text-[#00474d] hover:underline font-medium"
                    href="#"
                  >
                    Điều khoản dịch vụ
                  </a>{' '}
                  và{' '}
                  <a
                    className="text-[#00474d] hover:underline font-medium"
                    href="#"
                  >
                    Chính sách bảo mật
                  </a>
                  .
                </label>
              </div>
            </div>
            {touched.acceptedTerms && errors.acceptedTerms ? (
              <p className="text-xs text-[#ba1a1a]">{errors.acceptedTerms}</p>
            ) : null}

            {/* Submit Button */}
            <div className="pt-4">
              <button
                className="w-full flex justify-center py-3.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-semibold text-white bg-gradient-to-r from-[#00629d] to-[#006068] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#006068] transition-all h-[52px] items-center disabled:opacity-60 disabled:cursor-not-allowed"
                type="submit"
                disabled={isSubmitting || !isFormValid}
              >
                {isSubmitting ? (
                  <>
                    <span
                      className="material-symbols-outlined animate-spin mr-2"
                      style={{ fontSize: '20px' }}
                      aria-hidden="true"
                    >
                      progress_activity
                    </span>
                    Đang tạo tài khoản...
                  </>
                ) : (
                  'Tạo tài khoản'
                )}
              </button>
            </div>
          </form>

          {/* Login Link */}
          <div className="mt-6 text-center">
            <p className="text-base text-[#3f484a]">
              Đã có tài khoản?{' '}
              <Link
                className="font-medium text-[#00474d] hover:text-[#006068] transition-colors hover:underline"
                to="/login"
              >
                Đăng nhập
              </Link>
            </p>
          </div>

          {/* Trust Elements Desktop */}
          <div className="mt-10 pt-6 border-t border-[#e1e3e4] hidden md:flex flex-wrap justify-center gap-x-6 gap-y-2 text-[#3f484a] text-xs font-semibold">
            <div className="flex items-center gap-1.5">
              <span
                className="material-symbols-outlined text-[#6f797a]"
                style={{ fontSize: '16px' }}
                aria-hidden="true"
              >
                lock
              </span>
              Đăng ký bảo mật
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="material-symbols-outlined text-[#6f797a]"
                style={{ fontSize: '16px' }}
                aria-hidden="true"
              >
                verified_user
              </span>
              An ninh cấp doanh nghiệp
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="material-symbols-outlined text-[#6f797a]"
                style={{ fontSize: '16px' }}
                aria-hidden="true"
              >
                public
              </span>
              Được tin dùng toàn cầu
            </div>
          </div>
        </div>
      </div>

      {/* Inline keyframes for fade-in animation */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

export default PartnerRegisterPage
