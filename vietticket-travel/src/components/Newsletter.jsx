import { useState } from 'react'

function Newsletter() {
  const [email, setEmail] = useState('')

  const handleSubmit = (event) => {
    event.preventDefault()

    if (!email.trim()) {
      return
    }

    console.log('Email đăng ký nhận tin:', email.trim())
    setEmail('')
  }

  return (
    <section className="section newsletter-section">
      <div className="container">
        <div className="newsletter-panel">
          <div className="newsletter-content">
            <h2>
              Đăng ký để nhận ưu đãi du lịch Việt Nam, tin tức điểm tham quan
              mới nhất và các ưu đãi vé độc quyền
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
              <button className="button button--primary" type="submit">
                Đăng ký
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  )
}

export default Newsletter
