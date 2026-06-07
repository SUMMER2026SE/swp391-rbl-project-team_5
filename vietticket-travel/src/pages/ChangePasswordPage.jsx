import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import AccountLayout from '../components/auth/AccountLayout.jsx'
import PasswordInput from '../components/auth/PasswordInput.jsx'
import PasswordStrengthMeter from '../components/auth/PasswordStrengthMeter.jsx'
import { useAuth } from '../context/useAuth.js'
import { validatePassword } from '../utils/formValidators.js'

function ChangePasswordPage() {
  const navigate = useNavigate()
  const { user, changePassword } = useAuth()
  const [touched, setTouched] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })

  const isGoogleAccount = user?.provider === 'GOOGLE'
  const errors = useMemo(
    () => ({
      currentPassword: form.currentPassword ? '' : 'Vui lòng nhập mật khẩu hiện tại.',
      newPassword: validatePassword(form.newPassword),
      confirmPassword: !form.confirmPassword
        ? 'Vui lòng xác nhận mật khẩu.'
        : form.confirmPassword !== form.newPassword
          ? 'Mật khẩu xác nhận không khớp.'
          : '',
    }),
    [form],
  )
  const isFormValid = Object.values(errors).every((error) => !error)

  useEffect(() => {
    document.title = 'Đổi mật khẩu | VietTicket Travel'
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
    setTouched({ confirmPassword: true, currentPassword: true, newPassword: true })

    if (!isFormValid) {
      toast.error('Vui lòng kiểm tra lại mật khẩu.')
      return
    }

    setIsSubmitting(true)
    const result = await changePassword(form)
    setIsSubmitting(false)

    if (!result.ok) {
      toast.error(result.message || 'Không thể cập nhật mật khẩu.')
      return
    }

    toast.success(result.message || 'Cập nhật mật khẩu thành công.')
    navigate('/profile')
  }

  if (isGoogleAccount) {
    return (
      <AccountLayout active="password">
        <section className="account-card">
          <div className="account-card__header">
            <div>
              <p className="auth-helper">Hồ sơ của tôi / Đổi mật khẩu</p>
              <h1>Đổi mật khẩu</h1>
              <p>Tài khoản của bạn được liên kết với Google nên không cần đổi mật khẩu tại đây.</p>
            </div>
          </div>
          <Link className="auth-secondary-button" to="/profile">
            Quay lại hồ sơ
          </Link>
        </section>
      </AccountLayout>
    )
  }

  return (
    <AccountLayout active="password">
      <section className="account-card">
        <div className="account-card__header">
          <div>
            <p className="auth-helper">Hồ sơ của tôi / Đổi mật khẩu</p>
            <h1>Đổi mật khẩu</h1>
            <p>Sử dụng mật khẩu mạnh để bảo vệ tài khoản VietTicket Travel.</p>
          </div>
        </div>

        <form className="auth-form auth-form--relaxed" onSubmit={handleSubmit}>
          <PasswordInput
            id="change-current-password"
            label="Mật khẩu hiện tại"
            placeholder="Nhập mật khẩu hiện tại"
            value={form.currentPassword}
            error={touched.currentPassword ? errors.currentPassword : ''}
            onBlur={() => markTouched('currentPassword')}
            onChange={(event) => updateField('currentPassword', event.target.value)}
            required
          />
          <PasswordInput
            id="change-new-password"
            label="Mật khẩu mới"
            placeholder="Nhập mật khẩu mới"
            value={form.newPassword}
            error={touched.newPassword ? errors.newPassword : ''}
            onBlur={() => markTouched('newPassword')}
            onChange={(event) => updateField('newPassword', event.target.value)}
            required
          />
          <PasswordStrengthMeter password={form.newPassword} />
          <PasswordInput
            id="change-confirm-password"
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
          <div className="auth-actions-row">
            <button className="auth-submit" type="submit" disabled={isSubmitting || !isFormValid}>
              {isSubmitting ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}
            </button>
            <Link className="auth-secondary-button" to="/profile">
              Hủy
            </Link>
          </div>
        </form>

        <div className="security-tip">
          <span className="material-symbols-outlined filled" aria-hidden="true">
            verified_user
          </span>
          <div>
            <h2>Mẹo bảo mật tài khoản</h2>
            <p>
              Không bao giờ chia sẻ mật khẩu. VietTicket Travel sẽ không yêu cầu
              mật khẩu của bạn qua email, SMS hoặc tin nhắn.
            </p>
          </div>
        </div>
      </section>
    </AccountLayout>
  )
}

export default ChangePasswordPage
