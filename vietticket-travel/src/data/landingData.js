import halongBayImg from '../assets/halong_bay.webp'
import sapaImg from '../assets/sapa.webp'
import phuQuocImg from '../assets/phu_quoc.webp'
import ninhBinhImg from '../assets/ninh_binh.webp'
import hueImg from '../assets/hue.webp'
import daLatImg from '../assets/da_lat.webp'
import phongNhaImg from '../assets/phong_nha.webp'
import muiNeImg from '../assets/mui_ne.webp'

export const navLinks = [
  { label: 'Điểm tham quan', href: '/attractions' },
  { label: 'Điểm đến', href: '#destinations' },
  { label: 'Vé', href: '#services' },
  { label: 'Đặt chỗ', href: '#steps' },
  { label: 'Hỗ trợ', href: '#support' },
]

export const sliderSlides = [
  {
    title: 'Khám Phá Vẻ Đẹp Bất Tận Của Việt Nam',
    description: 'Tìm hiểu điểm tham quan, so sánh gói vé và đặt lịch trực tuyến cùng VietTicket Travel.',
    image: {
      src: halongBayImg,
      alt: 'Ha Long Bay Premium Travel Banner'
    },
    primaryCta: 'Khám phá ngay'
  },
  {
    title: 'Chạm Tay Vào Mây Tại Bà Nà Hills',
    description: 'Trải nghiệm Cầu Vàng hùng vĩ và không gian kiến trúc Pháp cổ kính tại Bà Nà Hills.',
    image: {
      src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDX-Ad4_zPAdfFoOpmu5R-2p4NZlWyLGnbNXpiOZrT6oTNZjctdEJjsQeRrfpYT7P0cVK8l47C7yH98wZYNgiht_3pc-h6Lbc5RKqQmZsT6KdHUGVoQkXMumfSgP6QakVNrcUlO0dVZTga3QJ2iJBt9fCDtrLB6A8mM14St51nlc_7ubsejK5TPWs7iDD7MaHZfCr7pHinT24CEy6JewQ1bIyXc7xDp3TGfx5avhtCs736b4Ghffiq-SImvE8LzqA1SRnKwvtHUhkM',
      alt: 'Ba Na Hills Premium Travel Banner'
    },
    primaryCta: 'Khám phá ngay'
  },
  {
    title: 'Hội An - Hoài Niệm Trong Từng Khoảnh Khắc',
    description: 'Đắm chìm trong vẻ đẹp lung linh của phố cổ về đêm. Dịch vụ đặt vé thuyền và thả hoa đăng nhanh chóng, tiện lợi.',
    image: {
      src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD5Js51DTlvDrM-hiAjBsIxz_mx-T1WHuheMfI0oxoxXH-ZDhcOc4Ju3Wn3F3yVCODqtiWOAKflM7sUWUPbMmRmLngujdUZn7nZXhA8zkZFv-JEWOtU9nrU8-UD4sviGglDoRcxdVny2mqNGJ6c-pMhggNL1rsuq4-lVCh8FXmeD8di552hptStvlxg2WZrMyE9r8VSEtNc1p54_k4OugcqqAg_1aL9rBmemwR7LZ0p2lvgViZjYipya3w-MiEY3uxGHfcjCkH1PeA',
      alt: 'Hoi An Premium Travel Banner'
    },
    primaryCta: 'Khám phá ngay'
  },
  {
    title: 'Sapa - Nấc Thang Lên Thiên Đường',
    description: 'Chiêm ngưỡng ruộng bậc thang hùng vĩ và đỉnh Fansipan mờ sương. Đặt tour và vé cáp treo Fansipan Legend tiện lợi.',
    image: {
      src: sapaImg,
      alt: 'Sapa Terraced Fields Scenic Banner'
    },
    primaryCta: 'Khám phá ngay'
  },
  {
    title: 'Phú Quốc - Thiên Đường Đảo Ngọc',
    description: 'Khám phá những bãi biển cát trắng mịn, hoàng hôn lãng mạn và tổ hợp giải trí VinWonders, Safari hàng đầu.',
    image: {
      src: phuQuocImg,
      alt: 'Phu Quoc Island Beach Resort Banner'
    },
    primaryCta: 'Khám phá ngay'
  },
  {
    title: 'Ninh Bình - Kỳ Quan Tràng An Tráng Lệ',
    description: 'Khám phá quần thể di sản thế giới với những dòng sông uốn lượn qua các hang động và núi đá vôi kỳ vĩ.',
    image: {
      src: ninhBinhImg,
      alt: 'Trang An Ninh Binh Landscape Banner'
    },
    primaryCta: 'Khám phá ngay'
  },
  {
    title: 'Cố Đô Huế - Dấu Ấn Vàng Son Một Thuở',
    description: 'Hành trình tìm về cội nguồn lịch sử với Đại Nội cổ kính, các lăng tẩm uy nghiêm và dòng sông Hương thơ mộng.',
    image: {
      src: hueImg,
      alt: 'Hue Imperial City Palace Banner'
    },
    primaryCta: 'Khám phá ngay'
  },
  {
    title: 'Đà Lạt - Thành Phố Ngàn Hoa Trong Sương',
    description: 'Tận hưởng bầu không khí mát mẻ quanh năm, những đồi thông reo và vô vàn điểm check-in thơ mộng.',
    image: {
      src: daLatImg,
      alt: 'Da Lat Pine Forest Sunrise Banner'
    },
    primaryCta: 'Khám phá ngay'
  },
  {
    title: 'Phong Nha - Vương Quốc Hang Động Kỳ Vĩ',
    description: 'Thám hiểm những hang động tráng lệ nhất thế giới và trải nghiệm các hoạt động thể thao mạo hiểm độc đáo.',
    image: {
      src: phongNhaImg,
      alt: 'Phong Nha Cave Underworld Banner'
    },
    primaryCta: 'Khám phá ngay'
  },
  {
    title: 'Mũi Né - Nắng Vàng Và Đồi Cát Trắng',
    description: 'Trải nghiệm trượt cát đầy phấn khích, dạo bước trên Suối Tiên và thưởng thức hải sản tươi ngon bên bờ biển lộng gió.',
    image: {
      src: muiNeImg,
      alt: 'Mui Ne Red Sand Dunes Banner'
    },
    primaryCta: 'Khám phá ngay'
  }
]

// Điểm tham quan nổi bật được tuyển chọn — dùng làm dữ liệu dự phòng khi API
// chưa có địa điểm đã duyệt, để trang chủ và trang khám phá luôn hiển thị nội dung.
export const featuredDestinations = [
  {
    id: 'feat-ha-long',
    title: 'Vịnh Hạ Long',
    city: 'Hạ Long',
    category: 'Nature & Sightseeing',
    minPrice: 290000,
    averageRating: 4.8,
    totalReviews: 1280,
    primaryImage: halongBayImg,
    searchQuery: 'Hạ Long',
  },
  {
    id: 'feat-fansipan',
    title: 'Cáp treo Fansipan Sa Pa',
    city: 'Sa Pa',
    category: 'Adventure',
    minPrice: 850000,
    averageRating: 4.9,
    totalReviews: 2150,
    primaryImage: sapaImg,
    searchQuery: 'Sa Pa',
  },
  {
    id: 'feat-vinwonders',
    title: 'VinWonders Phú Quốc',
    city: 'Phú Quốc',
    category: 'Theme Park & Resort',
    minPrice: 950000,
    averageRating: 4.7,
    totalReviews: 3120,
    primaryImage: phuQuocImg,
    searchQuery: 'Phú Quốc',
  },
  {
    id: 'feat-trang-an',
    title: 'Danh thắng Tràng An',
    city: 'Ninh Bình',
    category: 'Nature & Sightseeing',
    minPrice: 250000,
    averageRating: 4.8,
    totalReviews: 1890,
    primaryImage: ninhBinhImg,
    searchQuery: 'Tràng An',
  },
  {
    id: 'feat-dai-noi-hue',
    title: 'Đại Nội Huế',
    city: 'Huế',
    category: 'Cultural Experience',
    minPrice: 200000,
    averageRating: 4.6,
    totalReviews: 1420,
    primaryImage: hueImg,
    searchQuery: 'Huế',
  },
  {
    id: 'feat-da-lat',
    title: 'Quảng trường Lâm Viên Đà Lạt',
    city: 'Đà Lạt',
    category: 'Nature & Sightseeing',
    minPrice: 150000,
    averageRating: 4.5,
    totalReviews: 980,
    primaryImage: daLatImg,
    searchQuery: 'Đà Lạt',
  },
  {
    id: 'feat-phong-nha',
    title: 'Động Phong Nha',
    city: 'Quảng Bình',
    category: 'Adventure',
    minPrice: 550000,
    averageRating: 4.9,
    totalReviews: 1670,
    primaryImage: phongNhaImg,
    searchQuery: 'Phong Nha',
  },
  {
    id: 'feat-mui-ne',
    title: 'Đồi cát bay Mũi Né',
    city: 'Mũi Né',
    category: 'Nature & Sightseeing',
    minPrice: 120000,
    averageRating: 4.4,
    totalReviews: 760,
    primaryImage: muiNeImg,
    searchQuery: 'Mũi Né',
  },
]

export const heroContent = {
  eyebrow: 'KHÁM PHÁ CÁC ĐIỂM THAM QUAN TẠI VIỆT NAM',
  title:
    'Đặt vé tham quan Việt Nam, khám phá những địa danh tuyệt đẹp, du lịch dễ dàng hơn',
  description:
    'Khám phá các địa danh nổi tiếng trên khắp Việt Nam, so sánh lựa chọn vé, đặt trực tuyến và nhận vé điện tử QR sau khi đơn được xác nhận.',
  primaryCta: 'Tìm vé ngay',
  image: {
    src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD2s0dagy1CLVXEpwqyrx-wPQfglYGUES1psAi8Wxw7CKV-YZNi5DU88h_QVrWxRGatvI5hZ2lsfTNl0uxLDwjUFKMF3oAIM5p-SuYPASKS4pnjm-JtgR7csTR4q3SO3-pcg7ORka9mgewBmuR6pGyv-yxLPWWEk5ryAh3dzFwzc9eqPNUmpIRFDurZ12xevpQ_EhcrTRVW-NVLhQsTroLMSHRypKE-clWEEbDzngeSfIW3P-c8Y-TnS4j6a9Q9TBLrn0s4C5qotdg',
    alt: 'A professional high-fidelity photograph of a cheerful young traveler standing in front of the Golden Bridge in Ba Na Hills, Vietnam. She is holding a camera and a vintage map, surrounded by floating 3D map pins and subtle teal geometric shapes. The lighting is warm and golden-hour, creating an aspirational and luxury travel mood with vibrant tropical greens and deep sky blues.',
  },
  notification: {
    label: 'Vé điện tử',
    title: 'QR sau khi xác nhận',
    icon: 'qr_code_2',
  },
}

export const serviceCategories = [
  {
    title: 'Tìm kiếm điểm tham quan Việt Nam',
    description:
      'Khám phá các địa danh nổi tiếng, công viên giải trí, bảo tàng và điểm đến văn hóa tại Việt Nam.',
    icon: 'search',
  },
  {
    title: 'Vé điện tử QR tức thời',
    description:
      'Nhận vé kỹ thuật số nhanh chóng sau khi thanh toán trực tuyến thành công.',
    icon: 'qr_code_scanner',
    featured: true,
  },
  {
    title: 'Quản lý vé trong tài khoản',
    description:
      'Theo dõi trạng thái đặt chỗ, mở vé QR và gửi yêu cầu hỗ trợ trong cùng một tài khoản.',
    icon: 'account_circle',
  },
  {
    title: 'Đặt vé trực tuyến an toàn',
    description:
      'Đặt vé an toàn với thanh toán bảo mật, hỗ trợ voucher và chính sách hủy rõ ràng.',
    icon: 'verified_user',
  },
]

export const bookingSteps = [
  {
    title: 'Chọn điểm tham quan',
    description: 'Tìm kiếm và chọn một điểm du lịch hoặc địa danh văn hóa tại Việt Nam.',
    icon: 'location_on',
    tone: 'secondary',
  },
  {
    title: 'Chọn vé và ngày tham quan',
    description:
      'Chọn loại vé, ngày tham quan, khung giờ và số lượng khách.',
    icon: 'calendar_month',
    tone: 'container',
  },
  {
    title: 'Thanh toán và nhận vé QR',
    description:
      'Hoàn tất thanh toán trực tuyến và nhận vé điện tử QR ngay lập tức.',
    icon: 'account_balance_wallet',
    tone: 'primary',
  },
]

export const bookingPreview = {
  image: {
    src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAZnKpH6rTn_Nx_qVPBF1TRw2_kOf_342kUuyyX-oAU7mp3LEbT74VHrSROzmctfYloVgrAxjmuZBs5NHtpIy5rcE5oiINCLrGr1XwRjNkz_qGuHnCVng7rFGQJ5aY6rmC3k9XVAincrWAuseFUuKF-vSu4gbmPnOi7Zodp_ndFl9kvvTswlqaQ_GHxt5Mm8dtPFMx5XgCxPeXKff6Mi6scIfYPaHevBAwHbpaqH1N9qniQtVF81_P8O22X5DJKS3WhADKo-2ecquw',
    alt: 'Ảnh xem trước cổng Bà Nà Hills trong giao diện đặt vé',
  },
  title: 'Chuyến đi Bà Nà Hills',
  meta: ['14 tháng 6', '2 người lớn', 'Đang đặt chỗ'],
  tools: ['map', 'photo_camera', 'directions_bus'],
  progressLabel: 'Vé QR đã được tạo',
  progressStatus: 'Đã hoàn thành 80%',
}

export const footerLinks = {
  company: [
    { label: 'Về chúng tôi', href: '/about' },
    { label: 'Cách đặt vé', href: '/#steps', external: true },
    { label: 'Trở thành đối tác', href: '/partner/register' },
  ],
  support: [
    { label: 'Trung tâm hỗ trợ', href: '/support' },
    { label: 'Câu hỏi thường gặp', href: '/faq' },
    { label: 'Điều khoản dịch vụ', href: '/terms' },
    { label: 'Chính sách bảo mật', href: '/privacy' },
  ],
}
