import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import AuthCard from '../components/auth/AuthCard.jsx'
import AuthFormInput from '../components/auth/AuthFormInput.jsx'
import AuthLayout from '../components/auth/AuthLayout.jsx'
import GoogleButton from '../components/auth/GoogleButton.jsx'
import PasswordInput from '../components/auth/PasswordInput.jsx'
import PasswordStrengthMeter from '../components/auth/PasswordStrengthMeter.jsx'
import { useAuth } from '../context/useAuth.js'
import {
  validateEmail,
  validateFullName,
  validatePassword,
  validatePhone,
} from '../utils/formValidators.js'

const registerVisual =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuCw0Rm60MaLr1foI6gwgH8eOPOqUUK-fDsZQmwZYwQyy_TXgZtQuF9S9kQ_FYI3QGCqyyv2BwR7TTt11s6Y6qmL_LIp6STwYsjTdWZhYGVIcHdGU9ZyiIxdAyaVgiJkezCEIvczuLpaqZWPaBn1QIn8TJlCZCKRp-UapOQtDC8lywYjaHi9m-WIBo7HG1fceVTbfbhdddyhDdDDmHhFf_sDOaZKFAPUDb5s810bIcFOIzOgOLQR50jDo5J7rK-rZ7g2QDjOUG6WJ-A'

function RegisterPage() {
  const navigate = useNavigate()
  const { isAuthenticated, isAuthLoading, register, loginWithGoogle } = useAuth()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [touched, setTouched] = useState({})
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    acceptedTerms: false,
  })

  const errors = useMemo(
    () => ({
      fullName: validateFullName(form.fullName),
      email: validateEmail(form.email),
      phone: validatePhone(form.phone),
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
  const isFormValid = Object.values(errors).every((error) => !error)

  useEffect(() => {
    document.title = 'Đăng ký | VietTicket Travel'
  }, [])

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) {
      navigate('/profile', { replace: true })
    }
  }, [isAuthenticated, isAuthLoading, navigate])

  const updateField = (field, value) => {
    setTouched((current) => ({ ...current, [field]: true }))
    setForm((current) => ({ ...current, [field]: value }))
  }

  const markTouched = (field) => {
    setTouched((current) => ({ ...current, [field]: true }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setTouched({
      acceptedTerms: true,
      confirmPassword: true,
      email: true,
      fullName: true,
      password: true,
      phone: true,
    })

    if (!isFormValid) {
      toast.error('Vui lòng kiểm tra lại thông tin đăng ký.')
      return
    }

    setIsSubmitting(true)
    const result = await register(form)
    setIsSubmitting(false)

    if (!result.ok) {
      toast.error(result.message || 'Không thể tạo tài khoản.')
      return
    }

    toast.success(result.message || 'Vui lòng kiểm tra email để xác minh tài khoản.')
    navigate('/verify-email', {
      state: {
        pendingEmail: form.email,
      },
    })
  }

  const handleGoogleSignup = async (credentialResponse) => {
    if (!form.acceptedTerms) {
      setTouched((current) => ({ ...current, acceptedTerms: true }))
      toast.error('Vui lòng đồng ý Điều khoản dịch vụ và Chính sách bảo mật.')
      return
    }
    setIsSubmitting(true)
    const result = await loginWithGoogle({
      credential: credentialResponse.credential,
      acceptedTerms: true,
    })
    setIsSubmitting(false)

    if (!result.ok) {
      toast.error(result.message || 'Không thể đăng nhập Google.')
      return
    }

    toast.success(result.message || 'Đăng nhập Google thành công.')
    navigate('/')
  }

  return (
    <AuthLayout
      visualTitle="Bắt đầu hành trình khám phá Việt Nam ngay hôm nay."
      visualDescription="Tạo tài khoản để lưu điểm đến, đặt vé tham quan và nhận vé điện tử QR sau khi đơn được xác nhận."
      visualImage={registerVisual}
      visualAlt="Phố cổ Hội An lúc hoàng hôn với đèn lồng và dòng sông phản chiếu"
    >
      <AuthCard
        title="Tạo tài khoản mới"
        description="Tham gia VietTicket Travel để lên kế hoạch chuyến đi nhanh gọn hơn."
        footer={
          <p>
            Đã có tài khoản?{' '}
            <Link className="auth-link" to="/login">
              Đăng nhập
            </Link>
          </p>
        }
      >
        <form className="auth-form" onSubmit={handleSubmit}>
          <AuthFormInput
            id="register-name"
            label="Họ và tên"
            icon="person"
            type="text"
            placeholder="Nguyễn Minh Anh"
            value={form.fullName}
            error={touched.fullName ? errors.fullName : ''}
            onBlur={() => markTouched('fullName')}
            onChange={(event) => updateField('fullName', event.target.value)}
            required
          />
          <AuthFormInput
            id="register-email"
            label="Địa chỉ email"
            icon="mail"
            type="email"
            placeholder="email@vietticket.vn"
            value={form.email}
            error={touched.email ? errors.email : ''}
            onBlur={() => markTouched('email')}
            onChange={(event) => updateField('email', event.target.value)}
            required
          />
          <AuthFormInput
            id="register-phone"
            label="Số điện thoại"
            icon="phone"
            type="tel"
            placeholder="0901234567"
            value={form.phone}
            error={touched.phone ? errors.phone : ''}
            onBlur={() => markTouched('phone')}
            onChange={(event) => updateField('phone', event.target.value)}
            required
          />
          <PasswordInput
            id="register-password"
            label="Mật khẩu"
            placeholder="Tối thiểu 8 ký tự"
            value={form.password}
            error={touched.password ? errors.password : ''}
            onBlur={() => markTouched('password')}
            onChange={(event) => updateField('password', event.target.value)}
            required
          />
          <PasswordStrengthMeter password={form.password} />
          <PasswordInput
            id="register-confirm-password"
            label="Xác nhận mật khẩu"
            icon="lock_reset"
            placeholder="Nhập lại mật khẩu"
            value={form.confirmPassword}
            error={touched.confirmPassword ? errors.confirmPassword : ''}
            onBlur={() => markTouched('confirmPassword')}
            onChange={(event) => updateField('confirmPassword', event.target.value)}
            required
          />
          <label className="auth-checkbox">
            <input
              type="checkbox"
              checked={form.acceptedTerms}
              onChange={(event) => updateField('acceptedTerms', event.target.checked)}
              required
            />
            <span>
              Tôi đồng ý với <Link to="/terms">Điều khoản dịch vụ</Link> và{' '}
              <Link to="/privacy">Chính sách bảo mật</Link> của VietTicket Travel.
            </span>
          </label>
          {touched.acceptedTerms && errors.acceptedTerms ? (
            <p className="auth-field-error">{errors.acceptedTerms}</p>
          ) : null}
          <button className="auth-submit" type="submit" disabled={isSubmitting || !isFormValid}>
            {isSubmitting ? 'Đang tạo tài khoản...' : 'Tạo tài khoản'}
          </button>
          <div className="auth-divider">hoặc tiếp tục với</div>
          <GoogleButton
            onError={() => toast.error('Không thể đăng nhập Google.')}
            onSuccess={handleGoogleSignup}
          />
        </form>
      </AuthCard>
    </AuthLayout>
  )
}

export default RegisterPage
