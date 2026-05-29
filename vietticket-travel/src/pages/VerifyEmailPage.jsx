import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import AuthCard from '../components/auth/AuthCard.jsx'
import AuthFormInput from '../components/auth/AuthFormInput.jsx'
import AuthLayout from '../components/auth/AuthLayout.jsx'
import { PENDING_EMAIL_STORAGE_KEY } from '../context/authConstants.js'
import { useAuth } from '../context/useAuth.js'
import { validateEmail } from '../utils/formValidators.js'

const verifyVisual =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuDWdH5BASw_hQaPTL7FtHWKGJelqqoIT2M9R8BU21KbtFOH1JdCAJNn7ee3I_zUCW7PPm6h4eREYB2weKOz_AWmnX8ZQMbkhwPxudO0uQkSl1Q_gUm1NlCpGEiNDmnh8q2R-hIwq6n67bBESWDZMtKwsYJ4rGRytv9UczKWjZdEaSXugxE_1wvNJSZNI93-FKVSfzu62pvC9JZSZez_jbvfV5ZnImLi8B7DVMC1vpOwpzUEi-ibyghUAgIPwmeq7RiEG-1m4uZRMMg'

function VerifyEmailPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { verifyEmail, resendVerification } = useAuth()
  const urlToken = searchParams.get('token') || ''
  const hasAutoToken = Boolean(urlToken)
  const hasAutoVerified = useRef(false)
  const [pendingEmail] = useState(
    () =>
      location.state?.pendingEmail ||
      localStorage.getItem(PENDING_EMAIL_STORAGE_KEY) ||
      '',
  )
  const [token, setToken] = useState(urlToken)
  const [resendEmail, setResendEmail] = useState(pendingEmail)
  const [touchedEmail, setTouchedEmail] = useState(false)
  const [status, setStatus] = useState(hasAutoToken ? 'verifying' : 'idle')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const resendEmailError = useMemo(() => validateEmail(resendEmail), [resendEmail])

  useEffect(() => {
    document.title = 'Xác minh email | VietTicket Travel'
  }, [])

  useEffect(() => {
    if (!urlToken || hasAutoVerified.current) return undefined

    hasAutoVerified.current = true
    let redirectTimer

    async function autoVerify() {
      setStatus('verifying')
      const result = await verifyEmail({ token: urlToken })

      if (!result.ok) {
        setStatus('error')
        toast.error(result.message || 'Không thể xác minh email.')
        return
      }

      setStatus('success')
      toast.success(result.message || 'Xác minh email thành công.')
      redirectTimer = window.setTimeout(() => navigate('/login'), 3000)
    }

    autoVerify()

    return () => {
      window.clearTimeout(redirectTimer)
    }
  }, [navigate, urlToken, verifyEmail])

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!token.trim()) {
      toast.error('Vui lòng nhập mã xác minh email.')
      return
    }

    setIsSubmitting(true)
    const result = await verifyEmail({ token: token.trim() })
    setIsSubmitting(false)

    if (!result.ok) {
      toast.error(result.message || 'Không thể xác minh email.')
      return
    }

    toast.success(result.message || 'Xác minh email thành công.')
    navigate('/login')
  }

  const handleResend = async () => {
    setTouchedEmail(true)

    if (resendEmailError) {
      toast.error(resendEmailError)
      return
    }

    setIsResending(true)
    const result = await resendVerification({ email: resendEmail })
    setIsResending(false)

    if (!result.ok) {
      toast.error(result.message || 'Không thể gửi lại mã xác minh.')
      return
    }

    localStorage.setItem(PENDING_EMAIL_STORAGE_KEY, resendEmail)
    toast.success(result.message || 'Link xác minh mới đã được gửi.')
  }

  return (
    <AuthLayout
      compact
      visualTitle="Một mã xác minh mở ra hành trình Việt Nam tiếp theo."
      visualDescription="Bảo vệ tài khoản VietTicket Travel trước khi đặt vé QR và quản lý các điểm tham quan."
      visualImage={verifyVisual}
      visualAlt="Ruộng bậc thang Mù Cang Chải trong mùa lúa chín"
    >
      <AuthCard
        title="Xác minh email"
        description={
          pendingEmail
            ? `Chúng tôi đã gửi link xác minh đến ${pendingEmail}.`
            : 'Chúng tôi đã gửi link xác minh đến email của bạn.'
        }
        footer={
          <p>
            <Link className="auth-link" to="/login">
              Quay lại đăng nhập
            </Link>
          </p>
        }
      >
        {hasAutoToken ? (
          <div className="auth-form auth-form--relaxed">
            <div className="auth-loading-state" aria-live="polite">
              <span className="auth-spinner" aria-hidden="true" />
              <p>
                {status === 'verifying'
                  ? 'Đang xác minh email...'
                  : status === 'success'
                    ? 'Xác minh thành công. Bạn sẽ được chuyển về trang đăng nhập sau 3 giây.'
                    : 'Không thể xác minh email. Vui lòng kiểm tra lại link.'}
              </p>
            </div>
          </div>
        ) : (
          <form className="auth-form auth-form--relaxed" onSubmit={handleSubmit}>
            <AuthFormInput
              id="verify-token"
              label="Mã xác minh email"
              icon="key"
              type="text"
              placeholder="Dán token từ link email hoặc terminal backend"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
            <AuthFormInput
              id="verify-resend-email"
              label="Email nhận lại mã"
              icon="mail"
              type="email"
              placeholder="email@example.com"
              value={resendEmail}
              error={touchedEmail ? resendEmailError : ''}
              onBlur={() => setTouchedEmail(true)}
              onChange={(event) => setResendEmail(event.target.value)}
            />
            <button className="auth-submit" type="submit" disabled={isSubmitting || !token.trim()}>
              {isSubmitting ? 'Đang xác minh...' : 'Xác minh email'}
            </button>
            <button
              className="auth-secondary-button"
              type="button"
              disabled={isResending}
              onClick={handleResend}
            >
              {isResending ? 'Đang gửi lại...' : 'Gửi lại mã'}
            </button>
          </form>
        )}
      </AuthCard>
    </AuthLayout>
  )
}

export default VerifyEmailPage
