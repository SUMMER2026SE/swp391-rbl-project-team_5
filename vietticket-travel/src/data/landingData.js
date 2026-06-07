import halongBayImg from '../assets/halong_bay.png'
import sapaImg from '../assets/sapa.png'
import phuQuocImg from '../assets/phu_quoc.png'
import ninhBinhImg from '../assets/ninh_binh.png'
import hueImg from '../assets/hue.png'
import daLatImg from '../assets/da_lat.png'
import phongNhaImg from '../assets/phong_nha.png'
import muiNeImg from '../assets/mui_ne.png'

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
    description: 'Đặt vé tham quan các địa danh nổi tiếng với giá ưu đãi nhất. Trải nghiệm hành trình di sản cùng VietTicket Travel.',
    image: {
      src: halongBayImg,
      alt: 'Ha Long Bay Premium Travel Banner'
    },
    primaryCta: 'Khám phá ngay'
  },
  {
    title: 'Chạm Tay Vào Mây Tại Bà Nà Hills',
    description: 'Trải nghiệm Cầu Vàng hùng vĩ và không gian kiến trúc Pháp cổ kính. Đặt vé ngay để nhận ưu đãi lên đến 20%.',
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

export const heroContent = {
  eyebrow: 'KHÁM PHÁ CÁC ĐIỂM THAM QUAN TẠI VIỆT NAM',
  title:
    'Đặt vé tham quan Việt Nam, khám phá những địa danh tuyệt đẹp, du lịch dễ dàng hơn',
  description:
    'Khám phá các địa danh nổi tiếng trên khắp Việt Nam, so sánh các lựa chọn vé, đặt trực tuyến và nhận vé điện tử QR ngay lập tức.',
  primaryCta: 'Tìm vé ngay',
  demoCta: 'Xem bản demo',
  image: {
    src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD2s0dagy1CLVXEpwqyrx-wPQfglYGUES1psAi8Wxw7CKV-YZNi5DU88h_QVrWxRGatvI5hZ2lsfTNl0uxLDwjUFKMF3oAIM5p-SuYPASKS4pnjm-JtgR7csTR4q3SO3-pcg7ORka9mgewBmuR6pGyv-yxLPWWEk5ryAh3dzFwzc9eqPNUmpIRFDurZ12xevpQ_EhcrTRVW-NVLhQsTroLMSHRypKE-clWEEbDzngeSfIW3P-c8Y-TnS4j6a9Q9TBLrn0s4C5qotdg',
    alt: 'A professional high-fidelity photograph of a cheerful young traveler standing in front of the Golden Bridge in Ba Na Hills, Vietnam. She is holding a camera and a vintage map, surrounded by floating 3D map pins and subtle teal geometric shapes. The lighting is warm and golden-hour, creating an aspirational and luxury travel mood with vibrant tropical greens and deep sky blues.',
  },
  notification: {
    label: 'Giao hàng tức thì',
    title: 'Vé QR đã sẵn sàng',
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
    title: 'Gợi ý lịch trình cá nhân hóa',
    description:
      'Nhận đề xuất điểm tham quan dựa trên điểm đến, sở thích, phong cách và thời gian du lịch.',
    icon: 'lightbulb',
  },
  {
    title: 'Đặt vé trực tuyến an toàn',
    description:
      'Đặt vé an toàn với thanh toán bảo mật, hỗ trợ voucher và chính sách hủy rõ ràng.',
    icon: 'verified_user',
  },
]

export const popularDestinations = [
  {
    title: 'Sun World Bà Nà Hills',
    location: 'Đà Nẵng',
    price: 'từ 900.000 VND',
    duration: 'Chuyến đi 1 ngày',
    image: {
      src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDQst6K1QuEfgPUHFR7mdRUpkV0nnt0GqGSah_czLGK99eGdcu3erGfeJfNhxgJAgStYuzgDJKGB0OO4-fBvkLmqHy7Gz_0Ceo90d7__yRgXy7yP3j9ZW4AU3c4JE-jlCJVtxegDyFxQEkaRHkTsYEiDgKdyVhhxOr2K59Ur5LbDswIeSFTbo3nXfNMEBbuYWT7zbXz0mo1aOYmoy1iF-xaOXq9slYPcV4xpo8Bciwr6ca0crdaESrPrP3DdS2dB0ndo-e-H1_TSUw',
      alt: 'Cầu Vàng tại Sun World Bà Nà Hills ở Đà Nẵng',
    },
  },
  {
    title: 'VinWonders Phú Quốc',
    location: 'Phú Quốc',
    price: 'từ 950.000 VND',
    duration: 'Chuyến đi 1 ngày',
    image: {
      src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCoueG15EJv00e0Qkulc3zdyD_BP7r93jx_FS4ocjMEUUpOykM4_JDwLh7LxHr1ngqwBGNiemk30ezLW3xHowtt5UzrKISkwAAR9JXw5q-nfE4pTOAT2opE2khD6TzibkhaiBd7fpinFg3MA6yMtTXdyDTVIigsQdp1YcJJ0cYI8Sb7uyqBx1RufHL5awzDmbfVWOoPFXbiYKondIpasmdyyxBfjE5SKRB8RnP-VjkoP8y6jTj8DPa8EGFDoyt07k0VWU7UmckVjMg',
      alt: 'Công viên chủ đề VinWonders Phú Quốc với nhiều khu vui chơi rực rỡ',
    },
  },
  {
    title: 'Danh thắng Tràng An',
    location: 'Ninh Bình',
    price: 'từ 250.000 VND',
    duration: 'Chuyến đi nửa ngày',
    image: {
      src: 'https://lh3.googleusercontent.com/aida-public/AB6AXuC1X8WMcMR--heAAB-STtUTTWaL2RYDvv2F9PBZRpt2Bm01w8yq4PWhGqizXftk8xVqpzLLOs_t8ZfCVgcjoOn3wF9iH9FL2YbiRP0LTvAiEFPk1cc7iTShy20kvXI4xFgGaYQkYwd-ajaG5ntHBgOiljfKBKqejN1J3PT8v1bwbKH5JDhZOggdMQNqWKJGEPMY9zGlzq0cXaIT-kovAXSR0y0-WKpMQ58FdItADDh3y6xsVY9ZPLzpLRGCCl1bhqu0OadVXv0l-VM',
      alt: 'Thuyền gỗ trên dòng sông tại Tràng An, Ninh Bình',
    },
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

export const testimonials = [
  {
    name: 'Minh Anh',
    location: 'Đà Nẵng, Việt Nam',
    quote:
      'VietTicket Travel giúp tôi đặt vé tham quan ở Việt Nam rất nhanh và tránh phải xếp hàng dài trong chuyến đi.',
    avatar:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuC-PMEybVQHjABV5rB8yeP6z5MywHAKScgTohWrykQ-HWtpgmWkhK7uhJ4ZE_fAaOF-uTAm5XffKEnpZ1jSI5bF4sLzY80ql89xUWANdGtTKYmyQyL_vdHM0ymQKAdLw41Px-Vyu4TzThydlT_WMhx5LRUzIEnpJA6BvIz3NU5EVoRIvN2PS5odb0w1aqQYqykSxzqkwD7onar_MKoAO2ZlH4CgLdZOH1e3pcGVcAg5mwn4hYkGqcithY1sTgyIefe4kQokbowNmFk',
  },
  {
    name: 'James Carter',
    location: 'Sydney, Úc',
    quote:
      'Vé QR được gửi ngay sau khi thanh toán, còn thông tin điểm đến thì rất dễ để cả gia đình tôi theo dõi.',
    avatar:
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=160&q=80',
  },
  {
    name: 'Linh Tran',
    location: 'Thành phố Hồ Chí Minh, Việt Nam',
    quote:
      'Tôi thích việc có thể so sánh các điểm tham quan nổi bật và chọn ngày trước khi thanh toán trực tuyến.',
    avatar:
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=160&q=80',
  },
]

export const partners = [
  'Sun World',
  'VinWonders',
  'Klook',
  'Traveloka',
  'Du lịch Việt Nam',
]

export const footerLinks = {
  company: [
    { label: 'Về chúng tôi', href: '/#steps' },
    { label: 'Tuyển dụng', href: '/' },
    { label: 'Blog', href: '/' },
  ],
  support: [
    { label: 'Liên hệ', href: '/#support' },
    { label: 'FAQ', href: '/' },
    { label: 'Điều khoản dịch vụ', href: '/' },
    { label: 'Chính sách bảo mật', href: '/' },
  ],
}

export const appDownloadButtons = [
  { eyebrow: 'Tải trên', label: 'Google Play', icon: 'shop' },
  { eyebrow: 'Tải về từ', label: 'App Store', icon: 'phone_iphone' },
]
