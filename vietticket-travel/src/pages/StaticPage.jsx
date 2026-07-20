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
      ['Chủ thể của bản trình diễn', 'VietTicket Travel trong phạm vi website này là sản phẩm phần mềm học thuật do Team 5 phát triển cho học phần SWP391. Hệ thống chưa đại diện cho một pháp nhân kinh doanh du lịch và không nhận giao dịch thương mại ngoài môi trường trình diễn. Thông tin doanh nghiệp, địa chỉ đăng ký và hotline thương mại chỉ được công bố khi có đơn vị chủ quản hợp pháp trước thời điểm vận hành thực tế.'],
      ['Nguyên tắc vận hành', 'Thông tin điểm tham quan và hồ sơ đối tác được kiểm duyệt trước khi mở bán. Giá, tồn kho và điều kiện hoàn hủy được xác nhận lại trong quá trình đặt vé.'],
      ['Liên hệ bản trình diễn', 'Kênh hỗ trợ có lưu vết là Trung tâm hỗ trợ sau khi đăng nhập hoặc email support@vietticket.com. Bản trình diễn không công bố số hotline hay địa chỉ doanh nghiệp giả; thông tin pháp nhân bắt buộc phải được cấu hình và xác minh trước khi triển khai thương mại.'],
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
    updated: 'Cập nhật ngày 17 tháng 7 năm 2026',
    sections: [
      ['1. Đơn vị vận hành và phạm vi dịch vụ', 'Website hiện là sản phẩm học thuật của Team 5 trong học phần SWP391, chưa phải dịch vụ do một pháp nhân du lịch cung cấp ra thị trường. Trong mô hình nghiệp vụ, VietTicket Travel là nền tảng trung gian giúp khách hàng tìm kiếm, giữ chỗ, thanh toán và quản lý vé; đối tác điểm tham quan là bên cung cấp trải nghiệm và chịu trách nhiệm về nội dung, giấy phép cùng chất lượng tại địa điểm. Trước khi vận hành thương mại, tên pháp nhân, mã số doanh nghiệp, địa chỉ đăng ký và hotline phải được công bố tại mục này.'],
      ['2. Điều kiện sử dụng và tài khoản', 'Người dùng phải có năng lực thực hiện giao dịch theo pháp luật Việt Nam, cung cấp thông tin chính xác, bảo vệ thông tin đăng nhập và thông báo ngay khi phát hiện truy cập trái phép. Mọi thao tác thực hiện trong phiên đăng nhập hợp lệ được xem là do chủ tài khoản thực hiện, trừ khi có bằng chứng về sự cố bảo mật.'],
      ['3. Thông tin sản phẩm, giá và thuế phí', 'Mô tả, lịch hoạt động, điều kiện độ tuổi, giá bán, thuế phí và khả năng cung ứng do đối tác cập nhật và được hệ thống kiểm tra trước khi mở bán. Giá cuối cùng, ưu đãi và tổng tiền được hiển thị tại bước xác nhận; thông tin tại bước này được ưu tiên nếu khác nội dung quảng bá trước đó.'],
      ['4. Giữ chỗ và xác nhận đơn', 'Giữ chỗ chỉ có hiệu lực trong thời hạn hiển thị. Đơn đặt vé được xác nhận sau khi hệ thống ghi nhận thanh toán hợp lệ và kiểm tra lại tồn kho. Một số sản phẩm cần đối tác duyệt thủ công; trạng thái và thời hạn xử lý được hiển thị trong tài khoản. Nếu không thể xác nhận, hệ thống sẽ hủy đơn và xử lý hoàn tiền theo phương thức thanh toán ban đầu.'],
      ['5. Thanh toán', 'Giao dịch trực tuyến được chuyển tới cổng VNPay. VietTicket không yêu cầu và không lưu số thẻ hoặc mật khẩu ngân hàng. Khách hàng có trách nhiệm kiểm tra số tiền, mã đơn và kết quả trả về; trạng thái trên hệ thống VietTicket là căn cứ vận hành khi có sai lệch tạm thời với màn hình của ngân hàng.'],
      ['6. Voucher và khuyến mại', 'Mỗi voucher có thời hạn, giá trị đơn tối thiểu, giới hạn lượt dùng và mức giảm riêng. Voucher chỉ được ghi nhận khi hệ thống xác nhận tại bước đặt vé, không quy đổi thành tiền mặt và có thể bị thu hồi nếu giao dịch gian lận, trùng lặp hoặc vi phạm điều kiện chương trình.'],
      ['7. Hủy, không đến và hoàn tiền', 'Quyền hủy và số tiền hoàn phụ thuộc chính sách được lưu cùng gói vé, thời điểm gửi yêu cầu và trạng thái sử dụng. Vé đã check-in hoặc quá thời hạn hủy có thể không được hoàn. Thời gian tiền về còn phụ thuộc cổng thanh toán và ngân hàng phát hành; người dùng có thể theo dõi yêu cầu trong tài khoản hoặc Trung tâm hỗ trợ.'],
      ['8. Vé điện tử và check-in', 'Vé QR được phát hành sau khi đơn được xác nhận. Khách hàng phải bảo mật mã vé, xuất trình giấy tờ cần thiết và đến đúng ngày hoặc khung giờ đã chọn. Mỗi vé chỉ được check-in theo số lượt hợp lệ; ảnh chụp hoặc bản sao đã bị sử dụng sẽ bị từ chối.'],
      ['9. Hành vi bị cấm', 'Không được giả mạo danh tính, can thiệp hệ thống, tự động thu thập dữ liệu trái phép, lạm dụng voucher, bán lại vé trái điều kiện, tải nội dung độc hại hoặc sử dụng dịch vụ để thực hiện hành vi vi phạm pháp luật. VietTicket có thể tạm khóa tài khoản và bảo toàn chứng cứ khi phát hiện rủi ro.'],
      ['10. Nghĩa vụ của đối tác', 'Đối tác phải hoàn tất xác minh, duy trì giấy phép phù hợp, công bố đúng giá và chính sách, bảo đảm tồn kho, phục vụ khách đã được xác nhận và phối hợp giải quyết khiếu nại. Việc duyệt hồ sơ trên nền tảng không thay thế các giấy phép chuyên ngành mà đối tác phải có.'],
      ['11. Quyền sở hữu trí tuệ và nội dung', 'Giao diện, mã nguồn, nhãn hiệu và nội dung do VietTicket tạo được bảo hộ theo quy định áp dụng. Người dùng và đối tác chỉ đăng nội dung mình có quyền sử dụng, đồng thời cho phép VietTicket hiển thị nội dung đó trong phạm vi vận hành và quảng bá dịch vụ.'],
      ['12. Sự kiện bất khả kháng và giới hạn trách nhiệm', 'Trong trường hợp thiên tai, dịch bệnh, yêu cầu của cơ quan nhà nước, gián đoạn hạ tầng hoặc sự kiện ngoài khả năng kiểm soát hợp lý, VietTicket sẽ thông báo và phối hợp bảo vệ quyền lợi theo chính sách áp dụng. Không điều khoản nào loại trừ trách nhiệm mà pháp luật bắt buộc một bên phải chịu.'],
      ['13. Tạm ngừng và chấm dứt', 'VietTicket có thể giới hạn tính năng hoặc khóa tài khoản khi cần bảo vệ người dùng, ngăn gian lận, tuân thủ pháp luật hoặc xử lý vi phạm. Trường hợp phù hợp, người dùng sẽ được thông báo lý do và cơ chế khiếu nại; nghĩa vụ thanh toán, hoàn tiền và bảo mật đã phát sinh vẫn tiếp tục có hiệu lực.'],
      ['14. Khiếu nại và giải quyết tranh chấp', 'Người dùng nên gửi yêu cầu qua Trung tâm hỗ trợ, kèm mã đơn và tài liệu liên quan. Các bên ưu tiên thương lượng trên cơ sở dữ liệu giao dịch đã lưu. Nếu không giải quyết được, tranh chấp được xử lý theo pháp luật Việt Nam tại cơ quan có thẩm quyền.'],
      ['15. Thay đổi và liên hệ', 'Điều khoản mới sẽ ghi rõ ngày cập nhật và áp dụng cho giao dịch phát sinh sau thời điểm có hiệu lực, trừ trường hợp pháp luật yêu cầu khác. Trong môi trường trình diễn, câu hỏi được tiếp nhận qua Trung tâm hỗ trợ hoặc support@vietticket.com; không sử dụng website này cho giao dịch thương mại thực tế.'],
    ],
  },
  privacy: {
    title: 'Chính sách bảo mật',
    description: 'Cách VietTicket Travel thu thập, sử dụng và bảo vệ dữ liệu cá nhân.',
    heading: 'Chính sách bảo mật',
    updated: 'Cập nhật ngày 17 tháng 7 năm 2026',
    sections: [
      ['1. Bên kiểm soát dữ liệu và liên hệ', 'VietTicket Travel quyết định mục đích và phương thức xử lý dữ liệu phát sinh trên nền tảng. Yêu cầu liên quan đến dữ liệu cá nhân có thể gửi qua Trung tâm hỗ trợ sau khi đăng nhập hoặc tới support@vietticket.com; chúng tôi có thể cần xác minh danh tính trước khi thực hiện yêu cầu.'],
      ['2. Loại dữ liệu được xử lý', 'Hệ thống có thể xử lý thông tin tài khoản và liên hệ, hồ sơ cá nhân, vai trò và phiên đăng nhập, nội dung yêu thích, đơn đặt vé, thanh toán và hoàn tiền, vé và lịch sử check-in, đánh giá, trao đổi hỗ trợ, nhật ký bảo mật, cùng hồ sơ doanh nghiệp và tài liệu KYC của đối tác.'],
      ['3. Nguồn dữ liệu', 'Dữ liệu được cung cấp trực tiếp bởi người dùng hoặc đối tác, tạo ra khi sử dụng dịch vụ, nhận từ nhà cung cấp đăng nhập hoặc thanh toán theo yêu cầu của người dùng, và nhận từ nhân sự có thẩm quyền khi xử lý hỗ trợ, kiểm duyệt hoặc đối soát.'],
      ['4. Mục đích và căn cứ xử lý', 'Dữ liệu được dùng để tạo và bảo vệ tài khoản, thực hiện giao dịch, giữ tồn kho, phát hành vé, check-in, hoàn tiền, hỗ trợ khách hàng, kiểm duyệt đối tác, phòng chống gian lận, vận hành báo cáo và tuân thủ nghĩa vụ pháp lý. Việc xử lý dựa trên sự đồng ý khi cần, việc thực hiện hợp đồng, nghĩa vụ pháp lý và lợi ích hợp pháp trong bảo vệ nền tảng.'],
      ['5. Thanh toán', 'VNPay xử lý thông tin cần thiết để xác thực và hoàn tất giao dịch. VietTicket lưu mã giao dịch, số tiền, trạng thái và dữ liệu đối soát cần thiết nhưng không lưu số thẻ hoặc thông tin đăng nhập ngân hàng. Chính sách của VNPay áp dụng cho dữ liệu do cổng thanh toán trực tiếp thu thập.'],
      ['6. Hồ sơ KYC của đối tác', 'Tài liệu KYC được tách khỏi thư mục công khai, kiểm tra đường dẫn trước khi phục vụ và chỉ chủ hồ sơ cùng nhân sự có đúng thẩm quyền mới được truy cập. Thông tin đồng ý, phiên bản điều khoản và thời điểm gửi hồ sơ được lưu để chứng minh quy trình xác minh.'],
      ['7. Chia sẻ với bên nhận dữ liệu', 'Dữ liệu chỉ được chia sẻ trong phạm vi cần thiết với đối tác cung cấp trải nghiệm đã đặt, VNPay, nhà cung cấp đăng nhập, email, lưu trữ hoặc hạ tầng, cơ quan nhà nước có thẩm quyền và cố vấn chuyên môn chịu nghĩa vụ bảo mật. VietTicket không bán dữ liệu cá nhân cho bên thứ ba.'],
      ['8. Trợ lý AI và dịch vụ bên ngoài', 'Khi người dùng chủ động dùng tính năng trợ lý, nội dung câu hỏi và phần dữ liệu tối thiểu cần thiết có thể được gửi tới nhà cung cấp mô hình để tạo phản hồi. Không nên nhập mật khẩu, số thẻ, ảnh giấy tờ hoặc dữ liệu nhạy cảm không cần thiết vào cuộc trò chuyện. Kết quả AI chỉ có tính hỗ trợ và cần được kiểm tra trước khi đặt vé.'],
      ['9. Cookie và lưu trữ trên thiết bị', 'Hệ thống sử dụng cookie phiên HttpOnly cho đăng nhập và có thể dùng bộ nhớ trình duyệt cho tùy chọn giao diện, nội dung vừa xem hoặc dữ liệu tạm của hành trình. Cookie thiết yếu cần cho bảo mật và vận hành; dữ liệu không thiết yếu chỉ được dùng đúng mục đích đã thông báo.'],
      ['10. Biện pháp bảo mật', 'VietTicket áp dụng phân quyền theo vai trò, thu hồi phiên khi thay đổi bảo mật, giới hạn tần suất yêu cầu, kiểm tra loại và kích thước tệp, ghi nhật ký thao tác quan trọng, mã hóa đường truyền và quy trình sao lưu phù hợp. Không hệ thống nào tuyệt đối an toàn; khi phát hiện sự cố, chúng tôi sẽ cô lập, đánh giá và thông báo theo nghĩa vụ áp dụng.'],
      ['11. Thời hạn lưu trữ', 'Dữ liệu được giữ trong thời gian tài khoản hoặc giao dịch còn hoạt động và sau đó trong khoảng thời gian cần thiết để giải quyết khiếu nại, đối soát, phòng chống gian lận, bảo vệ quyền lợi hoặc tuân thủ pháp luật. Khi hết mục đích, dữ liệu sẽ được xóa, ẩn danh hoặc hạn chế truy cập theo quy trình vận hành.'],
      ['12. Quyền và lựa chọn của người dùng', 'Người dùng có thể xem và sửa hồ sơ, đổi mật khẩu, hủy nhận bản tin, rút lại sự đồng ý cho hoạt động dựa trên đồng ý, hoặc yêu cầu truy cập, chỉnh sửa, hạn chế và xóa dữ liệu khi pháp luật cho phép. Việc rút lại đồng ý không ảnh hưởng tính hợp pháp của xử lý đã thực hiện trước đó và một số dữ liệu giao dịch vẫn phải được lưu theo nghĩa vụ pháp lý.'],
      ['13. Người chưa thành niên', 'Tài khoản và giao dịch của người chưa đủ tuổi tự mình xác lập giao dịch phải được cha mẹ hoặc người giám hộ hợp pháp đồng ý. Nếu phát hiện dữ liệu trẻ em được cung cấp không phù hợp, người giám hộ có thể liên hệ để được kiểm tra và xử lý.'],
      ['14. Thay đổi chính sách', 'Phiên bản mới sẽ hiển thị ngày cập nhật và được thông báo phù hợp nếu có thay đổi đáng kể về mục đích hoặc phạm vi xử lý. Người dùng nên đọc lại chính sách trước khi tiếp tục sử dụng các tính năng có liên quan.'],
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
