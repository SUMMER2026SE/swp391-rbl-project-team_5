import { Link } from 'react-router-dom'

const intentGroups = [
  {
    title: 'Cuối tuần cùng gia đình',
    description: 'Công viên, khu vui chơi và resort dễ đi cho cả nhà.',
    icon: 'family_restroom',
    href: '/attractions?category=Theme%20Park%20%26%20Resort&sort=popular',
    tone: 'bg-[#eefcff] text-[#00474d] border-[#a6eff8]',
  },
  {
    title: 'Thiên nhiên thư giãn',
    description: 'Điểm ngắm cảnh, di sản và không gian xanh nhẹ nhàng.',
    icon: 'forest',
    href: '/attractions?category=Nature%20%26%20Sightseeing&sort=rating',
    tone: 'bg-[#f0f8ee] text-[#245022] border-[#cce8c8]',
  },
  {
    title: 'Văn hóa & lịch sử',
    description: 'Bảo tàng, phố cổ, di tích và trải nghiệm bản địa.',
    icon: 'museum',
    href: '/attractions?category=Cultural%20Experience&sort=rating',
    tone: 'bg-[#fff8e2] text-[#6b4b00] border-[#f5df9d]',
  },
  {
    title: 'Ngân sách tốt',
    description: 'Ưu tiên các lựa chọn giá dễ tiếp cận dưới 500k.',
    icon: 'savings',
    href: '/attractions?maxPrice=500000&sort=price-asc',
    tone: 'bg-[#f6f3ff] text-[#4d3f77] border-[#ddd4ff]',
  },
]

const trustSignals = [
  { label: 'Vé QR trên điện thoại', icon: 'qr_code_2' },
  { label: 'Thanh toán VNPay', icon: 'verified_user' },
  { label: 'Lọc theo nhu cầu', icon: 'tune' },
]

function TravelIntentSection() {
  return (
    <section className="section bg-white">
      <div className="container">
        <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
          <div>
            <p className="eyebrow">Chọn nhanh theo nhu cầu</p>
            <h2>Đi thẳng tới trải nghiệm hợp với chuyến đi của bạn</h2>
            <p className="mt-4 max-w-xl text-base font-medium leading-7 text-[#3e494a]">
              Những lối tắt này giúp khách tìm vé theo bối cảnh thật: đi cùng ai, muốn
              trải nghiệm gì và ngân sách ra sao.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 lg:justify-end">
            {trustSignals.map((item) => (
              <span
                className="inline-flex items-center gap-2 rounded-full border border-[#bdc9ca]/70 bg-[#f9f9fc] px-4 py-2 text-sm font-bold text-[#3e494a]"
                key={item.label}
              >
                <span className="material-symbols-outlined text-[18px] text-[#006068]" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </span>
            ))}
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {intentGroups.map((item) => (
            <Link
              className={`group flex min-h-[188px] flex-col justify-between rounded-2xl border p-5 transition hover:-translate-y-1 hover:shadow-[0_14px_34px_rgba(0,96,104,0.12)] focus:outline-none focus:ring-2 focus:ring-[#006068]/30 ${item.tone}`}
              key={item.title}
              to={item.href}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/75 shadow-sm">
                <span className="material-symbols-outlined text-[26px]" aria-hidden="true">
                  {item.icon}
                </span>
              </span>
              <span>
                <strong className="block text-lg font-extrabold text-[#1a1c1e]">
                  {item.title}
                </strong>
                <span className="mt-2 block text-sm font-semibold leading-6 text-[#3e494a]">
                  {item.description}
                </span>
              </span>
              <span className="inline-flex items-center gap-1 text-sm font-extrabold">
                Xem gợi ý
                <span className="material-symbols-outlined text-[18px] transition group-hover:translate-x-1" aria-hidden="true">
                  arrow_forward
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

export default TravelIntentSection
