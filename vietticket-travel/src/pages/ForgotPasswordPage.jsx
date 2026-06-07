import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import AuthCard from '../components/auth/AuthCard.jsx'
import AuthFormInput from '../components/auth/AuthFormInput.jsx'
import AuthLayout from '../components/auth/AuthLayout.jsx'
import { useAuth } from '../context/useAuth.js'
import { validateEmail } from '../utils/formValidators.js'

const forgotVisual =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuCLqlz6JtmInXEW-l-RSxXcPLV6SRzd5QKozizSriV68A3Nf8YHqDeN7CXMOv8Hg31yLDMmmp0irLLQXAKi5xAwFtr9Yiyvmkf4we3XUA1AlPYkowTC-zHt7x5YN7jhMDK89e23uYvRzBAXW0siP8kMlcL-OxBMwzaYo-4F0zZeUQw7LHZWxR1LoqqR_xnGaGjg_Pbx3-wbIGI8rBNqaDLkpJuL2QvSTPSt0IgTYvLKTX1EaHPADUsRjwHpvrq4FpsMJ8VflGGHRN4'

function ForgotPasswordPage() {
  const { forgotPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [touched, setTouched] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSent, setIsSent] = useState(false)
  const [sentMessage, setSentMessage] = useState('')
  const emailError = useMemo(() => validateEmail(email), [email])

  useEffect(() => {
    document.title = 'Quên mật khẩu | VietTicket Travel'
  }, [])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setTouched(true)

    if (emailError) {
      toast.error(emailError)
      return
    }

    setIsSubmitting(true)
    const result = await forgotPassword({ email })
    setIsSubmitting(false)

    if (!result.ok) {
      toast.error(result.message || 'Không thể gửi yêu cầu đặt lại mật khẩu.')
      return
    }

    setSentMessage(result.message)
    setIsSent(true)
    toast.success(result.message)
  }

  return (
    <AuthLayout
      visualTitle="Tìm lại hành trình của bạn."
      visualDescription="Khôi phục quyền truy cập tài khoản để tiếp tục quản lý vé tham quan Việt Nam một cách an tâm."
      visualImage={forgotVisual}
      visualAlt="Toàn cảnh Vịnh Hạ Long với làn nước xanh và núi đá vôi"
    >
      <AuthCard
        title="Quên mật khẩu"
        description="Nhập địa chỉ email và chúng tôi sẽ tạo link đặt lại mật khẩu nếu tài khoản tồn tại."
        footer={
          <p>
            <Link className="auth-link" to="/login">
              Quay lại đăng nhập
            </Link>
          </p>
        }
      >
        {isSent ? (
          <div className="auth-form auth-form--relaxed">
            <div className="auth-success-state">
              <span className="material-symbols-outlined filled" aria-hidden="true">
                mark_email_read
              </span>
              <p>{sentMessage || 'Nếu email tồn tại, link đặt lại đã được gửi.'}</p>
              <p className="auth-helper">Kiểm tra hộp thư đến (và thư mục Spam) của bạn.</p>
            </div>
            <p className="auth-helper auth-helper--note">
              Nếu bạn đăng nhập bằng Google, vui lòng dùng nút{' '}
              <Link className="auth-link" to="/login">
                Đăng nhập với Google
              </Link>{' '}
              thay vì đặt lại mật khẩu.
            </p>
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit}>
            <AuthFormInput
              id="forgot-email"
              label="Địa chỉ email"
              icon="mail"
              type="email"
              placeholder="example@gmail.com"
              value={email}
              error={touched ? emailError : ''}
              onBlur={() => setTouched(true)}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <p className="auth-helper auth-helper--note">
              Nếu bạn đăng nhập bằng Google, hãy dùng nút "Đăng nhập với Google" thay vì đặt lại mật khẩu.
            </p>
            <button className="auth-submit" type="submit" disabled={isSubmitting || Boolean(emailError)}>
              {isSubmitting ? 'Đang gửi...' : 'Gửi link đặt lại'}
            </button>
          </form>
        )}
      </AuthCard>
    </AuthLayout>
  )
}

export default ForgotPasswordPage
