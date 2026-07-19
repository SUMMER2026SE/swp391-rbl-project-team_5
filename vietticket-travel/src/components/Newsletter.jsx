import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'
import { apiRequest } from '../services/api'

function Newsletter() {
  const [email, setEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!email.trim() || isSubmitting) return
    setIsSubmitting(true)
    try {
      const response = await apiRequest('/newsletter/subscribe', {
        method: 'POST',
        body: { email: email.trim() },
      })
      toast.success(response.message)
      setEmail('')
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="section newsletter-section">
      <div className="container">
        <div className="newsletter-panel">
          <div className="newsletter-content">
            <h2>
              Đăng ký để nhận ưu đãi du lịch Việt Nam, tin tức điểm tham quan
              mới nhất và thông tin ưu đãi từ các điểm tham quan
            </h2>

            <form className="newsletter-form" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="newsletter-email">
                Địa chỉ email
              </label>
              <div className="newsletter-form__field">
                <span className="material-symbols-outlined" aria-hidden="true">
                  mail
                </span>
                <input
                  id="newsletter-email"
                  type="email"
                  placeholder="Địa chỉ email của bạn"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <button
                className="button button--primary"
                type="submit"
                value="subscribe"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Đang xử lý...' : 'Đăng ký'}
              </button>
            </form>
            <p style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6 }}>
              Khi đăng ký, bạn đồng ý nhận email ưu đãi. Bạn có thể hủy an toàn
              bằng liên kết cá nhân trong mỗi email. Xem{' '}
              <Link to="/privacy">Chính sách bảo mật</Link>.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export default Newsletter
