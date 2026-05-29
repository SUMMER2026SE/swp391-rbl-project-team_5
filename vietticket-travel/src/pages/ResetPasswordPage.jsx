import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'react-toastify'
import AuthCard from '../components/auth/AuthCard.jsx'
import AuthFormInput from '../components/auth/AuthFormInput.jsx'
import AuthLayout from '../components/auth/AuthLayout.jsx'
import PasswordInput from '../components/auth/PasswordInput.jsx'
import PasswordStrengthMeter from '../components/auth/PasswordStrengthMeter.jsx'
import { useAuth } from '../context/useAuth.js'
import { validatePassword } from '../utils/formValidators.js'

const resetVisual =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuC-j0Dp4sf0y_RpBFKWHe-qlLrf5ZFoY3X4o42LPE1CGyMMEnaS1paEaoT3lOlUflQ2r-N3_GIVUhu3ZTNNeZYYXYiWO9fYhteZxZ5Ao4PcQc5sH05higupVDB0wWt-swMZ8jlvYgfKIMJlvDSyoneJQOqSBtsc75niYe8tuFIsyaGg08knYonR0Sl5RlPIar5VPZqf8ZHxSPjjZaE_fD-G5wqIXR8guFOuvlyQXZCDTGRxrjmtyBbPIsS10WZ6932FEsNV-gs_1kA'

function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { resetPassword } = useAuth()
  const urlToken = searchParams.get('token') || ''
  const [touched, setTouched] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [form, setForm] = useState({
    token: urlToken,
    newPassword: '',
    confirmPassword: '',
  })

  const errors = useMemo(
    () => ({
      token: form.token.trim() ? '' : 'Vui lòng nhập mã đặt lại mật khẩu.',
      newPassword: validatePassword(form.newPassword),
      confirmPassword:
        form.confirmPassword && form.confirmPassword === form.newPassword
          ? ''
          : 'Mật khẩu xác nhận không khớp.',
    }),
    [form],
  )
  const isFormValid = Object.values(errors).every((error) => !error)

  useEffect(() => {
    document.title = 'Đặt lại mật khẩu | VietTicket Travel'
  }, [])

  const updateField = (field, value) => {
    setTouched((current) => ({ ...current, [field]: true }))
    setForm((current) => ({ ...current, [field]: value }))
  }

  const markTouched = (field) => {
    setTouched((current) => ({ ...current, [field]: true }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setTouched({ confirmPassword: true, newPassword: true, token: true })

    if (!isFormValid) {
      toast.error('Vui lòng kiểm tra lại thông tin đặt lại mật khẩu.')
      return
    }

    setIsSubmitting(true)
    const result = await resetPassword({
      token: form.token.trim(),
      newPassword: form.newPassword,
    })
    setIsSubmitting(false)

    if (!result.ok) {
      toast.error(result.message || 'Không thể đặt lại mật khẩu.')
      return
    }

    toast.success(result.message || 'Đặt lại mật khẩu thành công.')
    navigate('/login')
  }

  return (
    <AuthLayout
      compact
      visualTitle="Bảo vệ tài khoản và tiếp tục khám phá."
      visualDescription="Tạo mật khẩu mới cho tài khoản VietTicket Travel trước khi đặt vé tham quan tiếp theo."
      visualImage={resetVisual}
      visualAlt="Khung cảnh vịnh Việt Nam yên bình lúc bình minh"
    >
      <AuthCard
        title="Đặt lại mật khẩu"
        description="Nhập mật khẩu mới. Token sẽ được lấy tự động từ link email nếu có."
        footer={
          <p>
            <Link className="auth-link" to="/login">
              Quay lại đăng nhập
            </Link>
          </p>
        }
      >
        <form className="auth-form" onSubmit={handleSubmit}>
          {!urlToken ? (
            <AuthFormInput
              id="reset-token"
              label="Mã đặt lại"
              icon="key"
              type="text"
              placeholder="Dán token từ link email hoặc terminal backend"
              value={form.token}
              error={touched.token ? errors.token : ''}
              onBlur={() => markTouched('token')}
              onChange={(event) => updateField('token', event.target.value)}
              required
            />
          ) : null}
          <PasswordInput
            id="reset-new-password"
            label="Mật khẩu mới"
            placeholder="Tối thiểu 8 ký tự"
            value={form.newPassword}
            error={touched.newPassword ? errors.newPassword : ''}
            onBlur={() => markTouched('newPassword')}
            onChange={(event) => updateField('newPassword', event.target.value)}
            required
          />
          <PasswordStrengthMeter password={form.newPassword} />
          <PasswordInput
            id="reset-confirm-password"
            label="Xác nhận mật khẩu mới"
            icon="lock_reset"
            placeholder="Nhập lại mật khẩu mới"
            value={form.confirmPassword}
            error={touched.confirmPassword ? errors.confirmPassword : ''}
            onBlur={() => markTouched('confirmPassword')}
            onChange={(event) => updateField('confirmPassword', event.target.value)}
            required
          />
          <p className="auth-helper">
            Sử dụng ít nhất 8 ký tự, bao gồm chữ cái và số.
          </p>
          <button className="auth-submit" type="submit" disabled={isSubmitting || !isFormValid}>
            {isSubmitting ? 'Đang đặt lại...' : 'Đặt lại mật khẩu'}
          </button>
        </form>
      </AuthCard>
    </AuthLayout>
  )
}

export default ResetPasswordPage
