import { Link } from 'react-router-dom'
import { footerLinks } from '../data/landingData.js'

function Footer({ links = footerLinks }) {
  return (
    <footer className="site-footer" id="support">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Link
            className="brand brand--light"
            to="/"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            VietTicket Travel
          </Link>
          <p>
            Đặt vé đến các điểm tham quan tốt nhất tại Việt Nam với trải nghiệm
            đơn giản, an toàn và thân thiện với khách du lịch.
          </p>
        </div>

        <FooterLinkGroup title="Công ty" links={links.company} />
        <FooterLinkGroup title="Hỗ trợ" links={links.support} />

        <div className="footer-downloads">
          <h2>Đặt vé trực tuyến</h2>
          <p>Tìm điểm tham quan, thanh toán an toàn và quản lý vé QR ngay trên website.</p>
          <Link className="button button--secondary" to="/attractions">
            Khám phá điểm đến
          </Link>
        </div>
      </div>

      <div className="container footer-bottom">
        <div>
          <p>© 2026 VietTicket Travel — Sản phẩm học thuật Team 5, SWP391.</p>
          <p className="mt-1 text-sm opacity-80">Môi trường trình diễn, không phải pháp nhân kinh doanh du lịch. Hỗ trợ: support@vietticket.com</p>
        </div>
      </div>
    </footer>
  )
}

function FooterLinkGroup({ title, links }) {
  return (
    <div className="footer-links">
      <h2>{title}</h2>
      <ul>
        {links.map((link) => (
          <li key={link.label}>
            {link.external ? (
              <a href={link.href}>{link.label}</a>
            ) : (
              <Link to={link.href}>{link.label}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default Footer
