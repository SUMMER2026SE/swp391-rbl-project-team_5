'use strict';

// ============================================================
// chatKnowledgeService.js
// ------------------------------------------------------------
// Lớp điều phối nhẹ cho chatbot doanh nghiệp:
// - nhận diện ý định mà không tốn thêm một lượt gọi LLM;
// - truy xuất đúng phần tri thức VietTicket liên quan;
// - cung cấp metadata, quick replies và fallback có ích.
//
// Đây không phải search engine tổng quát. Dữ liệu giá/tồn vé vẫn phải
// đến từ aiCatalogService; dữ liệu đơn hàng vẫn phải đến từ truy vấn
// đã giới hạn theo userId trong aiAssistantService.
// ============================================================

const CHAT_INTENTS = Object.freeze({
  ACCOUNT: 'account',
  BOOKING: 'booking',
  CATALOG: 'catalog',
  GENERAL: 'general',
  GREETING: 'greeting',
  PARTNER: 'partner',
  PAYMENT: 'payment',
  PERSONAL: 'personal',
  PRIVACY: 'privacy',
  QR_TICKET: 'qr_ticket',
  REFUND: 'refund',
  SUPPORT: 'support',
  VOUCHER: 'voucher',
});

function normalizeKnowledgeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const KNOWLEDGE_ARTICLES = Object.freeze([
  {
    id: 'platform-overview',
    intent: CHAT_INTENTS.BOOKING,
    title: 'VietTicket Travel là gì',
    href: '/about',
    keywords: [
      'vietticket la gi',
      'gioi thieu',
      'nen tang',
      'dich vu',
      'dat ve nhu the nao',
      'cach dat ve',
    ],
    content:
      'VietTicket Travel là nền tảng tìm kiếm, giữ chỗ, thanh toán và quản lý vé tham quan. Website hiện là sản phẩm học thuật của Team 5 cho học phần SWP391, chưa đại diện cho một pháp nhân kinh doanh du lịch và không nhận giao dịch thương mại ngoài môi trường trình diễn.',
  },
  {
    id: 'booking-flow',
    intent: CHAT_INTENTS.BOOKING,
    title: 'Đặt vé và xác nhận đơn',
    href: '/faq',
    keywords: [
      'dat ve',
      'mua ve',
      'giu cho',
      'xac nhan don',
      'cho doi tac duyet',
      'pending partner',
      'mua nhieu loai ve',
      've nguoi lon va tre em',
      'cung mot don',
      'bao lau co ve',
      'nhan ve khi nao',
    ],
    content:
      'Khách chọn điểm tham quan, gói vé, ngày hoặc khung giờ, kiểm tra tổng tiền rồi thanh toán. Mỗi đơn trong bản demo chỉ chứa một loại vé để tồn kho, QR, voucher và chính sách hoàn/hủy không bị trộn; nếu nhóm cần vé người lớn và trẻ em, khách tạo từng đơn riêng. Lịch trình AI chỉ xếp các booking và giao dịch độc lập theo thứ tự rồi đưa khách trở lại danh sách sau mỗi giao dịch; đây không phải đơn hàng gộp. Nếu một dòng sau thất bại hoặc khách dừng, các booking đã thanh toán trước đó vẫn có hiệu lực và không tự động bị hủy/hoàn. Khách tiếp tục booking đang giữ, đặt lại riêng dòng đã hủy, hoặc quản lý từng booking trong Vé của tôi. Đơn chỉ được xác nhận sau khi hệ thống ghi nhận thanh toán hợp lệ và kiểm tra tồn kho. Với sản phẩm duyệt thủ công, tiền được ghi nhận trước khi đối tác duyệt; hạn phản hồi là thời điểm sớm hơn giữa 24 giờ sau thanh toán và giờ bắt đầu hoạt động. QR chỉ phát hành sau khi duyệt. Nếu bị từ chối hoặc quá hạn, booking bị hủy, hoàn kho và tạo yêu cầu hoàn bắt buộc 100% về phương thức thanh toán gốc.',
  },
  {
    id: 'payment',
    intent: CHAT_INTENTS.PAYMENT,
    title: 'Thanh toán qua VNPay',
    href: '/terms',
    keywords: [
      'thanh toan',
      'vnpay',
      'the atm',
      'the quoc te',
      'vi dien tu',
      'qr ngan hang',
      'giao dich',
      'tru tien',
      'thanh toan loi',
      'vat',
      'thue',
      'phi dich vu',
      'hoa don',
    ],
    content:
      'Giao dịch trực tuyến được chuyển tới VNPay. VietTicket lưu mã giao dịch, số tiền và trạng thái đối soát cần thiết nhưng không lưu số thẻ hoặc mật khẩu ngân hàng. Trạng thái đơn trên VietTicket là căn cứ vận hành khi màn hình ngân hàng và hệ thống tạm thời chưa đồng bộ. Bản demo chưa có mô hình thuế suất, phí dịch vụ hoặc phát hành hóa đơn VAT; tổng tiền hiển thị là số tiền của giao dịch demo và không được hiểu là đã bao gồm VAT.',
  },
  {
    id: 'refund',
    intent: CHAT_INTENTS.REFUND,
    title: 'Hủy vé và hoàn tiền',
    href: '/terms',
    keywords: [
      'hoan ve',
      'hoan tien',
      'huy ve',
      'doi ve',
      'doi ngay',
      'doi gio',
      'doi khung gio',
      'huy mot phan',
      'huy bot ve',
      'refund',
      'phi huy',
      'non refundable',
      'free cancellation',
      'refund with fee',
      'bao lau tien ve',
    ],
    content:
      'Khả năng hủy và số tiền hoàn phụ thuộc chính sách của đúng gói vé, hạn hủy, trạng thái đơn và việc vé đã check-in hay chưa. Bản demo chỉ hủy toàn bộ booking và toàn bộ mã QR; không hỗ trợ hủy bớt số vé, đổi ngày, đổi khung giờ hoặc đổi loại vé sau thanh toán. FREE_CANCELLATION có thể được hoàn toàn bộ khi còn đủ điều kiện; REFUND_WITH_FEE hủy toàn bộ booking nhưng số tiền nhận lại bị trừ phí — “hoàn một phần” là một phần giá trị giao dịch, không phải một phần số vé; NON_REFUNDABLE không hỗ trợ hoàn sau thanh toán. Muốn lịch khác, khách phải hủy toàn bộ khi đủ điều kiện rồi tạo booking mới theo giá/tồn kho hiện tại. Rescue chỉ là ngoại lệ khi nhà cung cấp gây gián đoạn và cần khách xác nhận. Kết quả cuối cùng phải được hệ thống hoặc nhân viên xác nhận.',
  },
  {
    id: 'electronic-ticket',
    intent: CHAT_INTENTS.QR_TICKET,
    title: 'Vé điện tử và mã QR',
    href: '/faq',
    keywords: [
      've qr',
      'ma qr',
      'e ticket',
      've dien tu',
      'check in',
      'checkin',
      'khong nhan duoc ve',
      'gui lai ve',
      'dung lai qr',
    ],
    content:
      'Vé QR được phát hành sau khi thanh toán thành công và đơn được xác nhận. Mỗi vé có mã riêng, chỉ được check-in theo số lượt hợp lệ và không nên chia sẻ công khai. Khách cần đến đúng ngày hoặc khung giờ đã chọn, trừ khi gói vé ghi linh hoạt cả ngày.',
  },
  {
    id: 'voucher',
    intent: CHAT_INTENTS.VOUCHER,
    title: 'Voucher và ưu đãi',
    href: '/terms',
    keywords: [
      'voucher',
      'ma giam gia',
      'ma uu dai',
      'khuyen mai',
      'giam gia',
      'voucher khong dung duoc',
      'dieu kien voucher',
    ],
    content:
      'Voucher được nhập ở bước thanh toán và chỉ được ghi nhận khi hệ thống xác nhận. Mỗi mã có thời hạn, giá trị đơn tối thiểu, giới hạn lượt dùng và mức giảm riêng; voucher không quy đổi thành tiền mặt.',
  },
  {
    id: 'support',
    intent: CHAT_INTENTS.SUPPORT,
    title: 'Trung tâm hỗ trợ',
    href: '/support',
    keywords: [
      'ho tro',
      'support',
      'lien he',
      'khieu nai',
      'nhan vien',
      'cham soc khach hang',
      'email',
      'hotline',
      'gui yeu cau',
    ],
    content:
      'Khách đã đăng nhập có thể tạo Support Ticket để xử lý vấn đề đơn hàng, thanh toán, hoàn tiền hoặc khiếu nại và theo dõi phản hồi có lưu vết. Trong môi trường trình diễn, có thể dùng Trung tâm hỗ trợ hoặc email support@vietticket.com; hệ thống không công bố hotline thương mại giả.',
  },
  {
    id: 'privacy-ai',
    intent: CHAT_INTENTS.PRIVACY,
    title: 'Bảo mật dữ liệu và trợ lý AI',
    href: '/privacy',
    keywords: [
      'bao mat',
      'rieng tu',
      'du lieu ca nhan',
      'ai luu gi',
      'chatbot luu',
      'chia se du lieu',
      'so the',
      'mat khau',
      'xoa du lieu',
      'quyen rieng tu',
    ],
    content:
      'Khi khách chủ động dùng trợ lý, câu hỏi và phần dữ liệu tối thiểu cần thiết có thể được gửi tới nhà cung cấp mô hình. Hệ thống che một số dữ liệu nhạy cảm trước khi gửi; khách không nên nhập mật khẩu, số thẻ, mã QR, token hoặc ảnh giấy tờ. VietTicket không lưu số thẻ hay thông tin đăng nhập ngân hàng.',
  },
  {
    id: 'account',
    intent: CHAT_INTENTS.ACCOUNT,
    title: 'Tài khoản và đăng nhập',
    href: '/login',
    keywords: [
      'tai khoan',
      'dang nhap',
      'dang ky',
      'quen mat khau',
      'doi mat khau',
      'xac minh email',
      'google login',
      'khoa tai khoan',
    ],
    content:
      'Người dùng cần cung cấp thông tin chính xác và tự bảo vệ phiên đăng nhập. Các thao tác quản lý vé, hoàn tiền và Support Ticket yêu cầu đăng nhập để hệ thống xác minh đúng chủ tài khoản. Không gửi mật khẩu hoặc mã xác thực qua chatbot.',
  },
  {
    id: 'partner',
    intent: CHAT_INTENTS.PARTNER,
    title: 'Đăng ký đối tác',
    href: '/partner/register',
    keywords: [
      'doi tac',
      'partner',
      'dang ky ban ve',
      'dang diem tham quan',
      'kyc',
      'hop tac',
      'nha cung cap',
    ],
    content:
      'Đối tác phải hoàn tất hồ sơ xác minh, duy trì giấy phép phù hợp, công bố đúng giá và chính sách, bảo đảm tồn kho và phối hợp giải quyết khiếu nại. Việc VietTicket duyệt hồ sơ không thay thế giấy phép chuyên ngành.',
  },
  {
    id: 'catalog',
    intent: CHAT_INTENTS.CATALOG,
    title: 'Tìm điểm tham quan và giá vé',
    href: '/attractions',
    keywords: [
      'dia diem',
      'tham quan',
      'du lich',
      'goi y',
      'gia ve',
      'con ve',
      'mo cua',
      'lich trinh',
      'choi gi',
      'di dau',
      'dia chi',
      'check in',
      'check-in',
      'diem gap',
      'mang theo',
      'bao gom',
      'khong bao gom',
      'xe lan',
      'tiep can',
    ],
    content:
      'Giá, lịch mở cửa, gói vé và tồn chỗ có thể thay đổi theo điểm tham quan và ngày đi. Chatbot chỉ nên khẳng định dữ liệu đang có trong catalog VietTicket; khách cần mở trang chi tiết và kiểm tra lại ở bước đặt vé.',
  },
]);

const INTENT_PATTERNS = Object.freeze({
  [CHAT_INTENTS.PERSONAL]: [
    've cua toi',
    'don cua toi',
    'don hang cua toi',
    'booking cua toi',
    'thanh toan cua toi',
    'hoan tien cua toi',
    'support cua toi',
    'ho tro cua toi',
    'voucher cua toi',
    'toi chua nhan duoc ve',
    'toi khong thay ve',
    'toi khong thay don',
    'trang thai don',
  ],
  [CHAT_INTENTS.REFUND]: [
    'hoan tien',
    'hoan ve',
    'huy ve',
    'doi ve',
    'refund',
    'phi huy',
    'tien ve',
  ],
  [CHAT_INTENTS.PAYMENT]: [
    'thanh toan',
    'vnpay',
    'tru tien',
    'giao dich',
    'ngan hang',
    'the atm',
  ],
  [CHAT_INTENTS.QR_TICKET]: [
    'ma qr',
    've qr',
    'e ticket',
    've dien tu',
    'check in',
    'checkin',
    'nhan ve',
  ],
  [CHAT_INTENTS.VOUCHER]: ['voucher', 'ma giam gia', 'ma uu dai', 'khuyen mai'],
  [CHAT_INTENTS.SUPPORT]: [
    'support',
    'ho tro',
    'lien he',
    'khieu nai',
    'nhan vien',
    'hotline',
  ],
  [CHAT_INTENTS.PRIVACY]: [
    'bao mat',
    'rieng tu',
    'du lieu ca nhan',
    'luu du lieu',
    'so the',
    'mat khau',
  ],
  [CHAT_INTENTS.ACCOUNT]: [
    'tai khoan',
    'dang nhap',
    'dang ky',
    'quen mat khau',
    'doi mat khau',
    'xac minh email',
  ],
  [CHAT_INTENTS.PARTNER]: ['doi tac', 'partner', 'kyc', 'dang ky ban ve', 'hop tac'],
  [CHAT_INTENTS.CATALOG]: [
    'dia diem',
    'tham quan',
    'du lich',
    'goi y',
    'gia ve',
    'con ve',
    'mo cua',
    'lich trinh',
    'choi gi',
    'di dau',
  ],
  [CHAT_INTENTS.BOOKING]: ['dat ve', 'mua ve', 'giu cho', 'xac nhan don'],
});

const INTENT_PRIORITY = [
  CHAT_INTENTS.PERSONAL,
  CHAT_INTENTS.REFUND,
  CHAT_INTENTS.PAYMENT,
  CHAT_INTENTS.QR_TICKET,
  CHAT_INTENTS.VOUCHER,
  CHAT_INTENTS.SUPPORT,
  CHAT_INTENTS.PRIVACY,
  CHAT_INTENTS.ACCOUNT,
  CHAT_INTENTS.PARTNER,
  CHAT_INTENTS.CATALOG,
  CHAT_INTENTS.BOOKING,
];

const GREETING_RE =
  /^(xin chao|chao|hello|hi|hey|alo|good morning|good afternoon|good evening)( ban| chatbot| vietticket| tro ly)?[ !.]*$/;
const FOLLOW_UP_RE =
  /\b(cai do|noi tren|thu nhat|thu hai|thu ba|con no|con cai nay|the nao|thi sao|vay sao|co khong|bao nhieu|tai sao|chi tiet hon|them nua|tie[p]? theo)\b/;
const PROMPT_INJECTION_PATTERNS = [
  /\b(ignore|bo qua|quen)\b.{0,30}\b(instruction|instructions|chi dan|huong dan|lenh)\b/,
  /\b(reveal|show|hien|tiet lo|in)\b.{0,30}\b(system prompt|developer message|prompt he thong)\b/,
  /\b(you are now|bay gio ban la|dong vai he thong|developer mode|jailbreak)\b/,
  /\b(bypass|vo hieu hoa|tat)\b.{0,30}\b(safety|bao mat|chinh sach|guardrail)\b/,
];
const CURRENT_INFORMATION_PATTERNS = [
  'hom nay',
  'bay gio',
  'moi nhat',
  'hien tai',
  'thoi tiet',
  'ket xe',
  'tin tuc',
  'ty gia',
  'gia vang',
  'gia co phieu',
  'lich bay',
];

function userHistoryMessages(history = []) {
  return history
    .filter((item) => item?.role === 'user')
    .map((item) => String(item.content || item.message || item.text || '').trim())
    .filter(Boolean);
}

function isFollowUpMessage(message) {
  const normalized = normalizeKnowledgeText(message);
  if (!normalized) return false;
  if (FOLLOW_UP_RE.test(normalized)) return true;
  return normalized.split(' ').length <= 5
    && /^(con|va|the|vay|neu|co|khong|bao nhieu|tai sao)\b/.test(normalized);
}

function buildContextualQuery(message, history = []) {
  const current = String(message || '').trim();
  if (!isFollowUpMessage(current)) return current;

  const previousUserTurns = userHistoryMessages(history).slice(-2);
  return [...previousUserTurns, current].filter(Boolean).join(' | ');
}

function classifyChatIntent(message, history = []) {
  const current = normalizeKnowledgeText(message);
  if (!current) return CHAT_INTENTS.GENERAL;
  if (GREETING_RE.test(current)) return CHAT_INTENTS.GREETING;

  const contextual = normalizeKnowledgeText(buildContextualQuery(message, history));
  const scores = new Map();

  for (const intent of INTENT_PRIORITY) {
    const patterns = INTENT_PATTERNS[intent] || [];
    const score = patterns.reduce((total, phrase) => {
      if (current.includes(phrase)) return total + 4;
      if (contextual.includes(phrase)) return total + 2;
      return total;
    }, 0);
    if (score > 0) scores.set(intent, score);
  }

  // Mã tham chiếu do khách chủ động đưa vào cũng là yêu cầu cá nhân.
  if (/\b(ma don|booking|ma ho tro)\s+[a-z0-9_-]{4,}\b/.test(current)) {
    scores.set(CHAT_INTENTS.PERSONAL, 10);
  }

  for (const intent of INTENT_PRIORITY) {
    const score = scores.get(intent) || 0;
    const bestScore = Math.max(0, ...scores.values());
    if (score === bestScore && score > 0) return intent;
  }
  return CHAT_INTENTS.GENERAL;
}

function tokenize(value) {
  return unique(
    normalizeKnowledgeText(value)
      .split(' ')
      .filter((token) => token.length >= 2),
  );
}

function unique(values) {
  return [...new Set(values)];
}

function retrieveKnowledge(query, intent, limit = 3) {
  const normalizedQuery = normalizeKnowledgeText(query);
  const queryTokens = new Set(tokenize(normalizedQuery));

  return KNOWLEDGE_ARTICLES
    .map((article) => {
      const haystack = normalizeKnowledgeText(
        `${article.title} ${article.keywords.join(' ')} ${article.content}`,
      );
      const keywordScore = article.keywords.reduce((score, keyword) => (
        normalizedQuery.includes(normalizeKnowledgeText(keyword)) ? score + 5 : score
      ), 0);
      const tokenScore = tokenize(haystack).reduce(
        (score, token) => score + (queryTokens.has(token) ? 1 : 0),
        0,
      );
      const intentScore = article.intent === intent ? 4 : 0;
      return {
        ...article,
        intentMatched: article.intent === intent,
        keywordScore,
        score: keywordScore + tokenScore + intentScore,
      };
    })
    .filter((article) => (
      article.score > 2
      && (
        intent === CHAT_INTENTS.GENERAL
        || article.intentMatched
        || article.keywordScore >= 5
      )
    ))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit))
    .map((article) => {
      const publicArticle = { ...article };
      delete publicArticle.intentMatched;
      delete publicArticle.keywordScore;
      return publicArticle;
    });
}

function formatKnowledgeContext(articles) {
  if (!Array.isArray(articles) || articles.length === 0) return '';
  return [
    'TRI THUC VIETTICKET DA TRUY XUAT (nguon noi bo dang tin cay):',
    ...articles.map((article) =>
      `- [${article.id}] ${article.title}: ${article.content} | link: ${article.href}`),
  ].join('\n');
}

function detectsPromptInjection(message) {
  const normalized = normalizeKnowledgeText(message);
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function needsCurrentInformationWarning(message) {
  const normalized = normalizeKnowledgeText(message);
  return CURRENT_INFORMATION_PATTERNS.some((phrase) => normalized.includes(phrase));
}

const SUGGESTIONS_BY_INTENT = Object.freeze({
  [CHAT_INTENTS.GREETING]: [
    'Gợi ý điểm tham quan ở Đà Nẵng',
    'Chính sách hoàn vé thế nào?',
    'Tôi nhận vé QR khi nào?',
  ],
  [CHAT_INTENTS.CATALOG]: [
    'Gợi ý theo ngân sách của tôi',
    'Còn vé vào cuối tuần không?',
    'Lập lịch trình tham quan',
  ],
  [CHAT_INTENTS.REFUND]: [
    'Kiểm tra điều kiện hoàn vé của tôi',
    'Tạo yêu cầu hỗ trợ ở đâu?',
  ],
  [CHAT_INTENTS.PAYMENT]: [
    'Thanh toán thành công nhưng chưa có vé',
    'VNPay trừ tiền nhưng đơn chưa cập nhật',
  ],
  [CHAT_INTENTS.PERSONAL]: [
    'Đơn của tôi đang ở trạng thái nào?',
    'Tôi cần hỗ trợ về vé của mình',
  ],
  [CHAT_INTENTS.QR_TICKET]: [
    'Tôi chưa nhận được vé QR',
    'Mã QR có dùng lại được không?',
  ],
  [CHAT_INTENTS.VOUCHER]: [
    'Vì sao voucher không áp dụng được?',
    'Voucher có điều kiện gì?',
  ],
  [CHAT_INTENTS.SUPPORT]: [
    'Cách tạo Support Ticket',
    'Xem yêu cầu hỗ trợ của tôi',
  ],
  [CHAT_INTENTS.PRIVACY]: [
    'Chatbot sử dụng dữ liệu nào?',
    'VietTicket có lưu số thẻ không?',
  ],
  [CHAT_INTENTS.ACCOUNT]: [
    'Tôi quên mật khẩu',
    'Vì sao cần đăng nhập để xem vé?',
  ],
  [CHAT_INTENTS.PARTNER]: [
    'Điều kiện đăng ký đối tác',
    'Quy trình duyệt hồ sơ KYC',
  ],
  [CHAT_INTENTS.BOOKING]: [
    'Tôi nhận vé khi nào?',
    'Tìm điểm tham quan',
    'Các phương thức thanh toán',
  ],
  [CHAT_INTENTS.GENERAL]: [
    'Tìm điểm tham quan trên VietTicket',
    'Hướng dẫn đặt vé',
  ],
});

const ACTIONS_BY_INTENT = Object.freeze({
  [CHAT_INTENTS.CATALOG]: [{ label: 'Khám phá điểm đến', href: '/attractions' }],
  [CHAT_INTENTS.PERSONAL]: [
    { label: 'Vé của tôi', href: '/my-tickets' },
    { label: 'Yêu cầu hỗ trợ', href: '/support' },
  ],
  [CHAT_INTENTS.REFUND]: [
    { label: 'Vé của tôi', href: '/my-tickets' },
    { label: 'Chính sách hoàn vé', href: '/terms' },
  ],
  [CHAT_INTENTS.PAYMENT]: [
    { label: 'Vé của tôi', href: '/my-tickets' },
    { label: 'Trung tâm hỗ trợ', href: '/support' },
  ],
  [CHAT_INTENTS.QR_TICKET]: [{ label: 'Vé của tôi', href: '/my-tickets' }],
  [CHAT_INTENTS.VOUCHER]: [{ label: 'Tìm vé', href: '/attractions' }],
  [CHAT_INTENTS.SUPPORT]: [
    { label: 'Tạo yêu cầu hỗ trợ', href: '/support' },
    { label: 'Yêu cầu của tôi', href: '/my-support' },
  ],
  [CHAT_INTENTS.PRIVACY]: [{ label: 'Chính sách bảo mật', href: '/privacy' }],
  [CHAT_INTENTS.ACCOUNT]: [{ label: 'Đăng nhập', href: '/login' }],
  [CHAT_INTENTS.PARTNER]: [{ label: 'Đăng ký đối tác', href: '/partner/register' }],
  [CHAT_INTENTS.BOOKING]: [
    { label: 'Tìm vé', href: '/attractions' },
    { label: 'Câu hỏi thường gặp', href: '/faq' },
  ],
});

function buildChatMetadata({
  articles = [],
  catalogCount = 0,
  intent = CHAT_INTENTS.GENERAL,
  personalContextAvailable = false,
  provider = 'fallback',
  currentInformationWarning = false,
  promptInjectionDetected = false,
} = {}) {
  const grounded = articles.length > 0 || catalogCount > 0 || personalContextAvailable;
  const sources = [];

  if (catalogCount > 0) {
    sources.push({ id: 'live-catalog', label: 'Catalog VietTicket', href: '/attractions' });
  }
  if (personalContextAvailable) {
    sources.push({ id: 'customer-account', label: 'Dữ liệu tài khoản đã xác thực', href: '/my-tickets' });
  }
  for (const article of articles) {
    if (sources.some((source) => source.id === article.id)) continue;
    sources.push({ id: article.id, label: article.title, href: article.href });
  }

  let confidence = 'general';
  if (personalContextAvailable || catalogCount > 0) confidence = 'verified';
  else if (articles.length > 0) confidence = 'grounded';
  if (intent === CHAT_INTENTS.GENERAL || currentInformationWarning) confidence = 'general';

  return {
    actions: ACTIONS_BY_INTENT[intent] || [],
    confidence,
    currentInformationWarning,
    grounded,
    intent,
    promptInjectionDetected,
    providerMode: provider === 'fallback' ? 'fallback' : 'ai',
    sources: sources.slice(0, 4),
    suggestions: SUGGESTIONS_BY_INTENT[intent] || SUGGESTIONS_BY_INTENT.general,
  };
}

function fallbackFromArticle(article) {
  if (!article) return '';
  return `${article.content}\n\nXem thêm: ${article.href}`;
}

function buildRuleBasedFallback({
  articles = [],
  catalog = [],
  intent = CHAT_INTENTS.GENERAL,
  message = '',
  personal = null,
  userAuthenticated = false,
} = {}) {
  if (intent === CHAT_INTENTS.GREETING) {
    return 'Xin chào! Mình là trợ lý VietTicket. Mình có thể hỗ trợ tìm điểm tham quan, giá vé, đặt vé, thanh toán, hoàn tiền, vé QR và tình trạng đơn của bạn.';
  }

  if (intent === CHAT_INTENTS.PERSONAL) {
    if (!userAuthenticated) {
      return 'Để kiểm tra đúng đơn hoặc vé của bạn, vui lòng đăng nhập rồi mở /my-tickets. Nếu vẫn cần hỗ trợ, bạn có thể tạo yêu cầu tại /support.';
    }

    const booking = personal?.bookings?.[0];
    const supportTicket = personal?.supportTickets?.[0];
    if (booking) {
      const title = booking.snapshotAttractionTitle
        || booking.reservation?.ticketProduct?.attraction?.title
        || 'điểm tham quan';
      const visitDate = booking.snapshotVisitDate || booking.reservation?.date;
      const parsedVisitDate = visitDate ? new Date(visitDate) : null;
      const date = parsedVisitDate && !Number.isNaN(parsedVisitDate.getTime())
        ? parsedVisitDate.toISOString().slice(0, 10)
        : 'chưa rõ';
      const supportText = supportTicket
        ? ` Yêu cầu hỗ trợ gần nhất đang ở trạng thái ${supportTicket.status}.`
        : '';
      return `Đơn gần nhất của bạn cho ${title} đang ở trạng thái ${booking.status}, ngày đi ${date}.${supportText} Bạn có thể xem chi tiết an toàn tại /my-tickets hoặc gửi yêu cầu tại /support.`;
    }

    return 'Mình chưa thấy đơn gần đây trong tài khoản này. Bạn có thể kiểm tra /my-tickets hoặc tạo yêu cầu tại /support để nhân viên xác minh thêm.';
  }

  if (intent === CHAT_INTENTS.CATALOG && catalog.length > 0) {
    const normalizedMessage = normalizeKnowledgeText(message);
    const asksOperationalDetails = [
      'check in',
      'check-in',
      'diem gap',
      'mang theo',
      'bao gom',
      'khong bao gom',
      'xe lan',
      'tiep can',
    ].some((phrase) => normalizedMessage.includes(phrase));
    if (asksOperationalDetails) {
      const attraction = catalog[0];
      const ticket = attraction.tickets?.[0];
      const listText = (value, emptyText) => (
        Array.isArray(value) && value.length > 0 ? value.join(', ') : emptyText
      );
      return [
        `${attraction.title}:`,
        `- Điểm gặp/check-in: ${attraction.meetingPoint || 'chưa được công bố; vui lòng kiểm tra trang chi tiết.'}`,
        `- Cách check-in: ${attraction.checkInInstructions || 'chưa được công bố; vui lòng kiểm tra trang chi tiết.'}`,
        `- Cần mang: ${listText(attraction.whatToBring, 'không có vật dụng bắt buộc được công bố')}`,
        `- Khả năng tiếp cận: ${attraction.accessibilityInfo || 'chưa được công bố; vui lòng liên hệ điểm tham quan.'}`,
        ticket
          ? `- ${ticket.name} bao gồm: ${listText(ticket.inclusions, 'chưa được công bố')}`
          : '',
        ticket
          ? `- Không bao gồm: ${listText(ticket.exclusions, 'không có khoản loại trừ được công bố')}`
          : '',
        `Xem và chọn đúng gói vé tại /attractions/${attraction.id}.`,
      ].filter(Boolean).join('\n');
    }
    const lines = catalog.slice(0, 3).map((attraction, index) => {
      const prices = (attraction.tickets || [])
        .map((ticket) => Number(ticket.price))
        .filter(Number.isFinite);
      const minPrice = prices.length ? Math.min(...prices) : Number(attraction.minPrice);
      const priceText = Number.isFinite(minPrice)
        ? `từ ${minPrice.toLocaleString('vi-VN')} VND`
        : 'xem giá trên trang chi tiết';
      return `${index + 1}. ${attraction.title} (${attraction.city || 'Việt Nam'}) — ${priceText}: /attractions/${attraction.id}`;
    });
    return `Mình tìm thấy các lựa chọn phù hợp trong catalog VietTicket:\n${lines.join('\n')}\n\nGiá và tồn vé có thể phụ thuộc ngày đi; hãy mở trang chi tiết để kiểm tra trước khi đặt.`;
  }

  const articleReply = fallbackFromArticle(articles[0]);
  if (articleReply) return articleReply;

  return 'Mình chưa thể tạo câu trả lời AI đầy đủ lúc này. Với thông tin VietTicket, bạn có thể xem /faq hoặc tạo yêu cầu tại /support. Nếu đây là câu hỏi kiến thức chung, vui lòng thử lại sau ít phút.';
}

module.exports = {
  CHAT_INTENTS,
  buildChatMetadata,
  buildContextualQuery,
  buildRuleBasedFallback,
  classifyChatIntent,
  detectsPromptInjection,
  formatKnowledgeContext,
  isFollowUpMessage,
  needsCurrentInformationWarning,
  normalizeKnowledgeText,
  retrieveKnowledge,
};
