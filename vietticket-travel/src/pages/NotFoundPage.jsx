import { Link } from 'react-router-dom'
import Footer from '../components/Footer'
import Header from '../components/Header'
import Seo from '../components/Seo'
import { footerLinks } from '../data/landingData'

function NotFoundPage() {
  return (
    <>
      <Seo
        title="Không tìm thấy trang"
        description="Trang bạn yêu cầu không tồn tại trên VietTicket Travel."
        noIndex
      />
      <Header />
      <main className="section section--muted">
        <div className="container text-center" style={{ maxWidth: 680 }}>
          <p className="eyebrow">LỖI 404</p>
          <h1 style={{ fontSize: 'clamp(36px, 7vw, 64px)', marginBottom: 16 }}>
            Trang này không tồn tại
          </h1>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 28 }}>
            Đường dẫn có thể đã thay đổi hoặc nội dung không còn được cung cấp.
          </p>
          <Link className="button button--primary button--large" to="/">
            Về trang chủ
          </Link>
        </div>
      </main>
      <Footer links={footerLinks} />
    </>
  )
}

export default NotFoundPage
