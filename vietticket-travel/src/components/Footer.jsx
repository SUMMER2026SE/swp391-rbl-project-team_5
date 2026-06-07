import { appDownloadButtons, footerLinks } from '../data/landingData.js'

function Footer({ links = footerLinks, appButtons = appDownloadButtons }) {
  return (
    <footer className="site-footer" id="support">
      <div className="container footer-grid">
        <div className="footer-brand">
          <a className="brand brand--light" href="#top">
            VietTicket Travel
          </a>
          <p>
            Đặt vé đến các điểm tham quan tốt nhất tại Việt Nam với trải nghiệm
            đơn giản, an toàn và thân thiện với khách du lịch.
          </p>
        </div>

        <FooterLinkGroup title="Công ty" links={links.company} />
        <FooterLinkGroup title="Hỗ trợ" links={links.support} />

        <div className="footer-downloads">
          <h2>Tải ứng dụng</h2>
          <div className="download-buttons">
            {appButtons.map((button) => (
              <button className="download-button" type="button" key={button.label}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  {button.icon}
                </span>
                <span>
                  <small>{button.eyebrow}</small>
                  {button.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="container footer-bottom">
        <p>© 2026 VietTicket Travel. Tất cả quyền được bảo lưu.</p>
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
            <a href={link.href}>{link.label}</a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default Footer
