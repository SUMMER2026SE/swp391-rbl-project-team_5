import Footer from '../components/Footer'
import Header from '../components/Header'
import Seo from '../components/Seo'
import { footerLinks } from '../data/landingData'

const PAGES = {
  about: {
    title: 'Về VietTicket Travel',
    description: 'Thông tin về nền tảng đặt vé tham quan VietTicket Travel.',
    heading: 'Du lịch thuận tiện hơn với vé điện tử minh bạch',
    sections: [
      ['VietTicket là gì?', 'VietTicket Travel là nền tảng kết nối du khách với các đơn vị vận hành điểm tham quan. Hệ thống hỗ trợ tìm kiếm, giữ chỗ, thanh toán trực tuyến và phát hành vé QR.'],
      ['Nguyên tắc vận hành', 'Thông tin điểm tham quan và hồ sơ đối tác được kiểm duyệt trước khi mở bán. Giá, tồn kho và điều kiện hoàn hủy được xác nhận lại trong quá trình đặt vé.'],
      ['Liên hệ', 'Các yêu cầu hỗ trợ có thể được gửi qua Trung tâm hỗ trợ sau khi đăng nhập hoặc qua email support@vietticket.com.'],
    ],
  },
  faq: {
    title: 'Câu hỏi thường gặp',
    description: 'Giải đáp các câu hỏi về đặt vé, thanh toán, vé QR và hoàn hủy.',
    heading: 'Câu hỏi thường gặp',
    sections: [
      ['Tôi nhận vé khi nào?', 'Vé QR được tạo sau khi thanh toán thành công và đơn được xác nhận. Với điểm cần duyệt thủ công, vé được phát hành sau khi đối tác phê duyệt.'],
      ['Tôi có thể hủy hoặc hoàn vé không?', 'Điều kiện phụ thuộc vào chính sách của từng gói vé. Mức hoàn dự kiến được hiển thị trước khi bạn gửi yêu cầu hoàn tiền.'],
      ['Thanh toán có an toàn không?', 'VietTicket chuyển giao dịch tới cổng VNPay và không lưu số thẻ ngân hàng trên hệ thống.'],
      ['Mã QR có dùng lại được không?', 'Không. Mỗi vé có mã riêng và chỉ được check-in một lần. Không chia sẻ mã QR công khai.'],
    ],
  },
  terms: {
    title: 'Điều khoản dịch vụ',
    description: 'Điều khoản sử dụng dịch vụ đặt vé của VietTicket Travel.',
    heading: 'Điều khoản dịch vụ',
    updated: 'Cập nhật ngày 12 tháng 6 năm 2026',
    sections: [
      ['1. Phạm vi dịch vụ', 'VietTicket cung cấp nền tảng trung gian để tìm kiếm, đặt và quản lý vé tham quan. Đơn vị vận hành điểm tham quan chịu trách nhiệm cung cấp trải nghiệm đúng thông tin đã công bố.'],
      ['2. Tài khoản', 'Người dùng phải cung cấp thông tin chính xác, bảo vệ thông tin đăng nhập và thông báo khi phát hiện truy cập trái phép.'],
      ['3. Giá và thanh toán', 'Tổng tiền, giảm giá và chính sách áp dụng được hiển thị trước khi xác nhận. Đơn chỉ có hiệu lực sau khi hệ thống ghi nhận thanh toán thành công và xác nhận tồn kho.'],
      ['4. Hủy và hoàn tiền', 'Yêu cầu hoàn tiền tuân theo chính sách của gói vé và trạng thái sử dụng. Thời gian tiền về phụ thuộc cổng thanh toán và ngân hàng phát hành.'],
      ['5. Check-in', 'Khách hàng phải xuất trình vé QR hợp lệ và giấy tờ cần thiết theo yêu cầu của điểm tham quan. Vé đã sử dụng không thể chuyển nhượng hoặc hoàn tiền.'],
      ['6. Giới hạn trách nhiệm', 'VietTicket không chịu trách nhiệm cho sự kiện bất khả kháng, nhưng sẽ hỗ trợ kết nối các bên và xử lý quyền lợi theo chính sách áp dụng.'],
    ],
  },
  privacy: {
    title: 'Chính sách bảo mật',
    description: 'Cách VietTicket Travel thu thập, sử dụng và bảo vệ dữ liệu cá nhân.',
    heading: 'Chính sách bảo mật',
    updated: 'Cập nhật ngày 12 tháng 6 năm 2026',
    sections: [
      ['1. Dữ liệu được thu thập', 'Hệ thống có thể xử lý thông tin tài khoản, liên hệ, đơn đặt vé, lịch sử hỗ trợ và tài liệu xác minh dành cho đối tác.'],
      ['2. Mục đích sử dụng', 'Dữ liệu được dùng để xác thực tài khoản, thực hiện đơn hàng, phát hành vé, chống gian lận, hỗ trợ khách hàng và đáp ứng nghĩa vụ pháp lý.'],
      ['3. Thanh toán', 'Giao dịch được xử lý qua VNPay. VietTicket không lưu số thẻ hoặc thông tin đăng nhập ngân hàng của khách hàng.'],
      ['4. Tài liệu đối tác', 'Tài liệu KYC được lưu ngoài thư mục công khai và chỉ chủ hồ sơ cùng nhân sự có thẩm quyền mới được truy cập.'],
      ['5. Bảo mật và lưu trữ', 'Hệ thống sử dụng cookie phiên HttpOnly, kiểm soát vai trò và các biện pháp kỹ thuật phù hợp. Dữ liệu được lưu trong thời gian cần thiết cho vận hành và nghĩa vụ pháp lý.'],
      ['6. Quyền của người dùng', 'Bạn có thể cập nhật hồ sơ, đổi mật khẩu hoặc liên hệ support@vietticket.com để yêu cầu hỗ trợ về dữ liệu cá nhân.'],
    ],
  },
}

function StaticPage({ type }) {
  const page = PAGES[type] || PAGES.about
  return (
    <>
      <Seo title={page.title} description={page.description} />
      <Header />
      <main className="section section--muted">
        <article className="container" style={{ maxWidth: 900 }}>
          <div
            style={{
              padding: 'clamp(24px, 5vw, 56px)',
              background: '#fff',
              border: '1px solid var(--color-outline-variant)',
              borderRadius: 24,
              boxShadow: '0 18px 50px rgba(17, 51, 54, 0.08)',
            }}
          >
            <p className="eyebrow">VIETTICKET TRAVEL</p>
            <h1 style={{ fontSize: 'clamp(30px, 5vw, 48px)', marginBottom: 12 }}>{page.heading}</h1>
            {page.updated && <p style={{ color: 'var(--color-text-muted)' }}>{page.updated}</p>}
            <div style={{ display: 'grid', gap: 28, marginTop: 40 }}>
              {page.sections.map(([heading, content]) => (
                <section key={heading}>
                  <h2 style={{ fontSize: 20, marginBottom: 8 }}>{heading}</h2>
                  <p style={{ lineHeight: 1.8, color: 'var(--color-text-muted)' }}>{content}</p>
                </section>
              ))}
            </div>
          </div>
        </article>
      </main>
      <Footer links={footerLinks} />
    </>
  )
}

export default StaticPage
