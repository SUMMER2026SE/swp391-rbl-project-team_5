const TRUST_ITEMS = [
  {
    icon: 'verified_user',
    title: 'Giá và tồn kho từ hệ thống',
    description: 'Giá vé, ngày tham quan và số chỗ được kiểm tra lại trước khi tạo đơn.',
  },
  {
    icon: 'qr_code_2',
    title: 'Vé điện tử có thể kiểm tra',
    description: 'Mỗi vé hợp lệ có mã QR riêng và trạng thái sử dụng được theo dõi.',
  },
  {
    icon: 'policy',
    title: 'Chính sách hiển thị rõ ràng',
    description: 'Điều kiện hoàn hủy của từng gói vé được công bố trước khi thanh toán.',
  },
]

function Testimonials() {
  return (
    <section className="section container testimonials-section">
      <div className="section-heading text-center">
        <p className="eyebrow">ĐẶT VÉ MINH BẠCH</p>
        <h2>Những điều VietTicket cam kết trong mỗi đơn hàng</h2>
      </div>
      <div className="destination-grid">
        {TRUST_ITEMS.map((item) => (
          <article className="testimonial-card" key={item.title}>
            <span className="material-symbols-outlined" aria-hidden="true">{item.icon}</span>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

export default Testimonials
