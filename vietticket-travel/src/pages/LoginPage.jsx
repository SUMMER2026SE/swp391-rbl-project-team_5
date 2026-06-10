import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import AuthCard from '../components/auth/AuthCard.jsx'
import AuthFormInput from '../components/auth/AuthFormInput.jsx'
import AuthLayout from '../components/auth/AuthLayout.jsx'
import GoogleButton from '../components/auth/GoogleButton.jsx'
import PasswordInput from '../components/auth/PasswordInput.jsx'
import { useAuth } from '../context/useAuth.js'
import { validateEmail, validatePassword } from '../utils/formValidators.js'

const loginVisual =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuAVowbGqIGo-Mmb9eT-r0-j3FeUjczFEc36Yrq-z-FSsp1GIeLe1jQkCidEbxiyXh2qcmDXCh2C6-yg_SAngB23GucrZ8GyNi07SyMD2V5jd_4sfc0FqoiuyU-17NSO9rtgvIfc42qakAZ9IP33bxYY34h9MW5PejkAWBvzBeZBJUGCXG0vR7Df9WEJfk1czYKqhD3l28jkzpjNGgzpONwYw2xCUXsgXHsvdFhOmxnL9xmaw-lORJI7c7sOn69d6KCJHrQv1thQjis'

function getSafeRedirect(loggedInUser, redirectFrom) {
  const defaultForRole =
    loggedInUser?.role === 'ADMIN'
      ? '/admin/users'
      : loggedInUser?.role === 'PARTNER'
        ? '/partner/dashboard'
        : '/'

  if (!redirectFrom) return defaultForRole

  const targetPath = redirectFrom.pathname || '/'

  // Validate role permissions for the redirect path
  if (targetPath.startsWith('/admin') && loggedInUser?.role !== 'ADMIN') {
    return defaultForRole
  }
  if (targetPath.startsWith('/partner') && loggedInUser?.role !== 'PARTNER') {
    return defaultForRole
  }

  // Prevent redirecting to login/register pages if already authenticated
  if (targetPath === '/login' || targetPath === '/register') {
    return defaultForRole
  }

  return `${targetPath}${redirectFrom.search || ''}${redirectFrom.hash || ''}`
}

function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, isAuthLoading, login, loginWithGoogle, demoLogin, user } = useAuth()
  const redirectFrom = location.state?.from
  const safeRedirectTo = useMemo(() => {
    return getSafeRedirect(user, redirectFrom)
  }, [user, redirectFrom])

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [touched, setTouched] = useState({})
  const [form, setForm] = useState({
    email: '',
    password: '',
    remember: true,
  })

  const errors = useMemo(
    () => ({
      email: validateEmail(form.email),
      password: validatePassword(form.password),
    }),
    [form.email, form.password],
  )
  const isFormValid = !errors.email && !errors.password

  useEffect(() => {
    document.title = 'Đăng nhập | VietTicket Travel'
  }, [])

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) {
      navigate(safeRedirectTo, { replace: true })
    }
  }, [isAuthenticated, isAuthLoading, navigate, safeRedirectTo])

  const updateField = (field, value) => {
    setTouched((current) => ({ ...current, [field]: true }))
    setForm((current) => ({ ...current, [field]: value }))
  }

  const markTouched = (field) => {
    setTouched((current) => ({ ...current, [field]: true }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setTouched({ email: true, password: true })

    if (!isFormValid) {
      toast.error('Vui lòng kiểm tra lại thông tin đăng nhập.')
      return
    }

    setIsSubmitting(true)
    const result = await login(form)
    setIsSubmitting(false)

    // Network error (backend chưa chạy) — dùng demo fallback
    if (!result.status) {
      demoLogin({ fullName: form.email.split('@')[0], email: form.email })
      toast.info('Chạy ở chế độ demo (không có server). Đăng nhập thành công!')
      navigate(safeRedirectTo || '/', { replace: true })
      return
    }

    if (!result.ok) {
      if (result.code === 'EMAIL_NOT_VERIFIED') {
        toast.error(
          <span>
            Email chưa được xác minh.{' '}
            <a
              href="/verify-email"
              style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}
            >
              Xác minh ngay
            </a>
          </span>,
          { autoClose: 6000 },
        )
      } else {
        toast.error(result.message || 'Không thể đăng nhập bằng thông tin này.')
      }
      return
    }

    toast.success(result.message || 'Đăng nhập thành công.')
    const dest = getSafeRedirect(result.user, redirectFrom)
    navigate(dest, { replace: Boolean(redirectFrom) })
  }

  const handleGoogleSuccess = async (credentialResponse) => {
    setIsSubmitting(true)
    const result = await loginWithGoogle({ credential: credentialResponse.credential })
    setIsSubmitting(false)

    if (!result.ok) {
      toast.error(result.message || 'Không thể đăng nhập Google.')
      return
    }

    toast.success(result.message || 'Đăng nhập Google thành công.')
    const dest = getSafeRedirect(result.user, redirectFrom)
    navigate(dest, { replace: Boolean(redirectFrom) })
  }

  return (
    <AuthLayout
      visualTitle="Việt Nam đang chờ tấm vé tiếp theo của bạn."
      visualDescription="Truy cập đặt chỗ, điểm tham quan đã lưu, vé QR và ưu đãi du lịch độc quyền trong một không gian an toàn."
      visualImage={loginVisual}
      visualAlt="Vịnh Hạ Long lúc hoàng hôn với núi đá vôi và thuyền du lịch"
    >
      <AuthCard
        title="Chào mừng trở lại"
        description="Đăng nhập để quản lý đặt chỗ và tiếp tục khám phá Việt Nam."
        footer={
          <p>
            Chưa có tài khoản?{' '}
            <Link className="auth-link" to="/register">
              Đăng ký ngay
            </Link>
          </p>
        }
      >
        <form className="auth-form" onSubmit={handleSubmit}>
          <AuthFormInput
            id="login-email"
            label="Địa chỉ email"
            icon="mail"
            type="email"
            placeholder="email@example.com"
            value={form.email}
            error={touched.email ? errors.email : ''}
            onBlur={() => markTouched('email')}
            onChange={(event) => updateField('email', event.target.value)}
            required
          />
          <PasswordInput
            id="login-password"
            label="Mật khẩu"
            placeholder="Nhập mật khẩu"
            value={form.password}
            error={touched.password ? errors.password : ''}
            onBlur={() => markTouched('password')}
            onChange={(event) => updateField('password', event.target.value)}
            required
          />

          <div className="auth-options">
            <label className="auth-checkbox">
              <input
                type="checkbox"
                checked={form.remember}
                onChange={(event) => updateField('remember', event.target.checked)}
              />
              Ghi nhớ đăng nhập
            </label>
            <Link className="auth-link" to="/forgot-password">
              Quên mật khẩu?
            </Link>
          </div>

          <button className="auth-submit" type="submit" disabled={isSubmitting || !isFormValid}>
            {isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>

          <div className="auth-divider">hoặc tiếp tục với</div>

          <GoogleButton
            onError={() => toast.error('Không thể đăng nhập Google.')}
            onSuccess={handleGoogleSuccess}
          />
        </form>
      </AuthCard>
    </AuthLayout>
  )
}

export default LoginPage
