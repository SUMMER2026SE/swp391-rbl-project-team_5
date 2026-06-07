import { Link } from 'react-router-dom'

const BENEFITS = [
  {
    icon: 'storefront',
    title: 'Đăng ký miễn phí',
    desc: 'Không phí ẩn, không cam kết dài hạn. Bắt đầu ngay hôm nay.',
  },
  {
    icon: 'trending_up',
    title: 'Tăng doanh thu',
    desc: 'Tiếp cận hàng triệu du khách đang tìm kiếm trải nghiệm tại Việt Nam.',
  },
  {
    icon: 'bar_chart',
    title: 'Quản lý dễ dàng',
    desc: 'Bảng điều khiển trực quan: vé, lịch trình, báo cáo — tất cả ở một nơi.',
  },
]

function PartnerCTASection() {
  return (
    <section
      style={{
        background: 'linear-gradient(135deg, var(--color-primary) 0%, #004a52 100%)',
        padding: 'var(--section-gap) 0',
      }}
    >
      <div className="container" style={{ textAlign: 'center' }}>
        {/* Eyebrow */}
        <p
          className="eyebrow"
          style={{ color: 'rgba(255,255,255,0.65)', marginBottom: 12 }}
        >
          DÀNH CHO CHỦ ĐIỂM THAM QUAN
        </p>

        {/* Headline */}
        <h2
          style={{
            color: '#ffffff',
            fontSize: 36,
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          Phát triển doanh nghiệp cùng VietTicket
        </h2>

        {/* Subheadline */}
        <p
          style={{
            color: 'rgba(255,255,255,0.8)',
            fontSize: 17,
            lineHeight: 1.65,
            maxWidth: 580,
            margin: '0 auto 52px',
          }}
        >
          Đưa điểm tham quan của bạn đến với hàng triệu du khách. Quản lý vé,
          đặt chỗ và doanh thu trên một nền tảng duy nhất — miễn phí và dễ
          dàng.
        </p>

        {/* Benefits */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 32,
            justifyContent: 'center',
            marginBottom: 52,
          }}
        >
          {BENEFITS.map((b) => (
            <div
              key={b.icon}
              style={{
                flex: '1 1 200px',
                maxWidth: 220,
                background: 'rgba(255,255,255,0.08)',
                borderRadius: 16,
                padding: '24px 20px',
                backdropFilter: 'blur(6px)',
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{
                  fontSize: 36,
                  color: 'var(--color-secondary-container)',
                  marginBottom: 12,
                  display: 'block',
                }}
              >
                {b.icon}
              </span>
              <p
                style={{
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: 15,
                  marginBottom: 6,
                }}
              >
                {b.title}
              </p>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 1.55 }}>
                {b.desc}
              </p>
            </div>
          ))}
        </div>

        {/* CTA Button */}
        <Link
          className="button button--secondary button--large"
          to="/partner/register"
          style={{ fontSize: 15 }}
        >
          Trở thành đối tác ngay
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 20, marginLeft: 8 }}
          >
            arrow_forward
          </span>
        </Link>

        {/* Trust note */}
        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, marginTop: 20 }}>
          Đã có{' '}
          <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>
            500+
          </span>{' '}
          đối tác tin tưởng VietTicket
        </p>
      </div>
    </section>
  )
}

export default PartnerCTASection
