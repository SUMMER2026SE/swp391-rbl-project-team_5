# VietTicket Rescue — đặc tả nghiệp vụ và kế hoạch triển khai

## 1. Bài toán khách hàng

Khách đã thanh toán và nhận vé nhưng nhà cung cấp buộc phải hủy hoạt động vì sự cố vận hành. Luồng hiện tại chỉ hủy vé, vô hiệu QR và chuyển sang hoàn tiền. Dù đúng về tài chính, khách vẫn bị mất kế hoạch trong ngày, phải tự tìm sản phẩm thay thế, chờ hoàn tiền rồi thanh toán lại.

VietTicket Rescue giải quyết đúng thời điểm này:

- bảo toàn quyền hoàn 100% của khách;
- đề xuất phương án thay thế có thể đặt thật, không phải nội dung AI tưởng tượng;
- cho phép đổi ngay bằng khoản tiền đã thu, không bắt khách thanh toán lại;
- hoàn phần chênh lệch nếu phương án mới rẻ hơn;
- cấp booking và QR mới, không bao giờ khôi phục QR đã hủy;
- cập nhật mục đã đặt trong Live Trip nếu booking cũ đang nằm trong hành trình.

## 2. Phạm vi sản phẩm

### 2.1 Điều kiện kích hoạt

Một `RecoveryCase` chỉ được tạo khi thỏa tất cả điều kiện:

1. booking đang `CONFIRMED`;
2. có giao dịch VNPay `SUCCESS`, không phải giao dịch trùng, hoặc là booking thay thế có thể truy vết về giao dịch VNPay đó;
3. chưa có vé nào `USED`;
4. hoạt động chưa bắt đầu;
5. đối tác hủy booking đã xác nhận;
6. hệ thống tìm được ít nhất một phương án thay thế hợp lệ tại thời điểm hủy.

Nếu thiếu bất kỳ điều kiện nào hoặc không có phương án thay thế, hệ thống giữ nguyên nghiệp vụ an toàn hiện có: xếp hàng hoàn 100% ngay.

### 2.2 Phương án thay thế hợp lệ

Mỗi phương án phải được tạo từ dữ liệu catalog và tồn kho thật:

- điểm tham quan khác điểm đã bị hủy;
- cùng thành phố đã snapshot trên booking gốc;
- cùng ngày sử dụng;
- sản phẩm, điểm tham quan và trạng thái vận hành đều đang mở bán;
- không yêu cầu đối tác duyệt thủ công;
- cùng loại vé (`ADULT`, `CHILD`, `STUDENT`, ...);
- còn đủ số lượng ở cả ba tầng kho: sản phẩm, điểm tham quan và khung giờ;
- chưa qua thời gian nhận đặt vé;
- tổng giá mới không vượt `recoveryCredit` bằng số tiền booking gốc đã thu;
- không áp dụng voucher mới trong luồng cứu chuyến.

Các lựa chọn được xếp hạng theo khả năng giữ nguyên trải nghiệm: cùng môi trường hoạt động, gần vị trí cũ, đánh giá cao, chênh lệch giá thấp và giờ bắt đầu gần giờ cũ. Điểm xếp hạng chỉ sắp thứ tự; mọi điều kiện tồn kho và giá vẫn là luật cứng.

### 2.3 Quyền lựa chọn của khách

- Hệ thống không tự đổi booking.
- Khách có thể chọn “Đổi sang phương án này” hoặc “Nhận hoàn tiền 100%”.
- Thời hạn mặc định để chọn là 30 phút.
- Nếu hết hạn, hệ thống tự chuyển sang hoàn 100%.
- Trong MVP an toàn tài chính, chỉ hiển thị phương án bằng hoặc rẻ hơn tiền đã thu. Phương án đắt hơn bị loại thay vì tạo thêm một giao dịch có nguy cơ khách phải ứng tiền lần hai.

## 3. Mô hình trạng thái

`RecoveryCaseStatus`:

- `OPEN`: khách còn thời gian lựa chọn;
- `REPLACED`: đã đổi thành công và đã cấp booking/QR mới;
- `REFUND_PENDING`: khách từ chối, hết hạn hoặc không còn lựa chọn; hoàn tiền đã được xếp hàng;
- `REFUNDED`: hoàn tiền đã hoàn tất (dành cho đồng bộ worker);

Chuyển trạng thái hợp lệ:

```text
OPEN ──accept──> REPLACED
OPEN ──decline─> REFUND_PENDING ──gateway success──> REFUNDED
OPEN ──timeout─> REFUND_PENDING ──gateway success──> REFUNDED
```

`OPEN` là trạng thái duy nhất cho phép quyết định. Mỗi case gắn duy nhất với một booking gốc; một booking thay thế chỉ thuộc tối đa một case.

## 4. Bất biến giao dịch

1. Hủy booking gốc, trả kho gốc, vô hiệu QR cũ và tạo case phải nằm trong cùng transaction.
2. Chấp nhận phương án phải chạy transaction `Serializable`.
3. API nhận `optionKey` chứa `ticketProductId`, `timeSlotId` và ngày, nhưng backend luôn tải lại catalog, giá và kho; không tin tên hoặc giá từ frontend.
4. Kho mới được claim bằng cập nhật có điều kiện. Nếu một trong ba tầng kho không đủ, toàn bộ transaction rollback.
5. Claim case bằng `updateMany where status = OPEN AND expiresAt > now`; vì vậy hai tab không thể đổi hai lần.
6. Booking mới có payment ledger `RECOVERY_CREDIT/SUCCESS` để báo cáo doanh thu và đối soát không coi đây là booking miễn phí.
7. Tổng giá booking mới không được vượt khoản tiền đã thu.
8. Nếu giá mới thấp hơn, chỉ phần chênh lệch được hoàn qua VNPay; nếu bằng giá thì không tạo refund.
9. QR booking cũ giữ `EXPIRED`; booking mới luôn nhận token QR mới.
10. Nếu bất kỳ bước nào lỗi, case vẫn `OPEN`, không mất quyền hoàn tiền của khách.
11. Nếu booking thay thế lại bị nhà cung cấp hủy, case mới kế thừa `fundingBookingId` của chuỗi; tổng các khoản hoàn không được vượt số tiền VNPay đã thu.
12. Nếu khách chủ động hủy booking thay thế, hệ thống áp dụng chính sách và phí đã snapshot của vé thay thế nhưng chuyển khoản hoàn về giao dịch VNPay nguồn; `targetBookingId` lưu rõ vé nào thực sự bị hủy.

## 5. Dữ liệu lưu vết

`RecoveryCase` lưu:

- người sở hữu;
- booking bị hủy, booking thay thế và booking sở hữu giao dịch VNPay nguồn (`fundingBookingId`);
- nguồn sự cố, lý do;
- hạn quyết định;
- khoản tín dụng từ payment gốc;
- giá phương án đã chọn và khoản chênh lệch hoàn;
- snapshot booking gốc và snapshot lựa chọn;
- thời điểm chấp nhận/từ chối/hoàn tất;
- phiên bản phục vụ kiểm soát cạnh tranh;
- audit timestamps.

Không lưu danh sách gợi ý như sự thật lâu dài vì tồn kho thay đổi liên tục. API tạo lại gợi ý khi khách mở trang và tái xác thực lần cuối khi chấp nhận.

## 6. API

### Khách hàng

- `GET /api/recovery-cases?status=OPEN`: danh sách case của chính khách hàng; tự xử lý case quá hạn trước khi trả dữ liệu.
- `GET /api/recovery-cases/:id`: chi tiết case và phương án hiện còn hợp lệ.
- `POST /api/recovery-cases/:id/accept` body `{ ticketProductId, timeSlotId }`: đổi booking.
- `POST /api/recovery-cases/:id/decline`: chọn hoàn 100%.

### Phản hồi quan trọng

- `404`: case không thuộc khách hoặc không tồn tại;
- `409 RECOVERY_ALREADY_DECIDED`: case đã được xử lý ở tab/thiết bị khác;
- `409 RECOVERY_EXPIRED`: đã hết hạn và hoàn tiền được xếp hàng;
- `409 OPTION_UNAVAILABLE`: giá, catalog hoặc kho đã thay đổi; frontend tải lại lựa chọn;
- `422 OPTION_NOT_ELIGIBLE`: lựa chọn sai ngày, sai thành phố, sai loại vé hoặc vượt hạn mức.

## 7. UX

### 7.1 Cảnh báo thời gian thực

Sau khi partner hủy:

- socket gửi `RECOVERY_CASE_CREATED` tới room của khách;
- banner toàn cục xuất hiện ngay, giải thích ngắn gọn “vé bị hủy — kế hoạch của bạn vẫn có thể được cứu”;
- CTA đi thẳng tới Trung tâm cứu chuyến;
- banner không che thao tác chính trên mobile và có trạng thái truy cập màn hình đọc.

### 7.2 Trung tâm cứu chuyến

Trang phải hiển thị theo thứ tự:

1. sự cố và booking gốc;
2. quyền lợi rõ ràng: đổi miễn thanh toán lại hoặc hoàn 100%;
3. đồng hồ thời hạn;
4. phương án có kho thật, giá thật, khoảng cách, giờ, đánh giá và lý do phù hợp;
5. so sánh tài chính: đã trả, giá mới, hoàn chênh lệch;
6. xác nhận trước thao tác;
7. trạng thái thành công với mã booking mới và đường dẫn xem e-ticket.

Nội dung không dùng từ “AI đảm bảo”. Hệ thống nói rõ lựa chọn được kiểm tra lại khi xác nhận và tiền hoàn tuân theo thời gian xử lý cổng thanh toán.

## 8. Tác động hệ thống

- **Booking:** booking gốc vẫn `CANCELLED`; booking mới `CONFIRMED`.
- **Inventory:** trả kho gốc trước, claim kho mới khi khách đồng ý.
- **Payment/refund:** giữ payment gốc làm nguồn tiền; tạo ledger recovery cho booking mới; hoàn toàn bộ hoặc phần chênh lệch trên payment gốc. Chuỗi đổi nhiều lần luôn truy về cùng `fundingBookingId`, khóa theo idempotency key riêng và chỉ đóng booking nguồn khi tổng tiền đã hoàn bằng số tiền đã thu.
- **Customer cancellation:** booking dùng `RECOVERY_CREDIT` vẫn được xem trước và yêu cầu hoàn theo chính sách của vé mới; yêu cầu tài chính gắn với booking VNPay nguồn còn `targetBookingId` gắn với booking cần trả kho/vô hiệu QR.
- **Voucher:** lượt dùng voucher gốc được trả khi booking bị hủy; voucher không tự chuyển sang booking mới.
- **Settlement:** booking mới có commission và partner net theo đối tác mới; booking gốc bị hủy không được ghi nhận doanh thu.
- **Ticket/check-in:** QR cũ hết hiệu lực, QR mới dùng quy trình check-in hiện hữu.
- **Review:** chỉ booking mới hoàn tất mới có quyền đánh giá.
- **Live Trip:** mục gắn booking cũ được chuyển sang booking mới và snapshot mới; SmartQueue cũ bị hủy vì địa điểm đã thay đổi.
- **PartySync:** không tự thay đổi lựa chọn nhóm vì PartySync là giai đoạn trước đặt vé.

## 9. Kế hoạch triển khai

1. Thêm schema, migration, indexes và ràng buộc unique.
2. Tách dịch vụ nghiệp vụ: tìm gợi ý, tạo case khi hủy, hết hạn/hoàn tiền, chấp nhận và đồng bộ Live Trip.
3. Mở rộng dịch vụ hoàn tiền để hỗ trợ khoản chênh lệch có idempotency key riêng.
4. Tích hợp vào luồng partner hủy đã xác nhận; giữ nguyên fallback hoàn 100%.
5. Thêm controller, route bảo vệ CUSTOMER, audit log và realtime.
6. Thêm API frontend, banner realtime, trang Rescue responsive và trạng thái lỗi.
7. Viết unit/integration tests cho luật xếp hạng, quyền sở hữu, timeout, double-submit, hết kho và hoàn chênh lệch.
8. Chạy Prisma validate/generate, backend tests, frontend tests, lint và production build.
9. Seed một kịch bản demo cục bộ có booking gốc và ít nhất hai phương án.
10. Chạy backend/frontend thật, đăng nhập partner để hủy, đăng nhập customer để nhận cảnh báo, đổi vé, kiểm tra booking/QR/kho/refund/audit trong database.
11. Kiểm thử hồi quy booking, payment, refund, partner cancellation, e-ticket, check-in và Live Trip.
12. Review code, UX, access control, cạnh tranh giao dịch và dữ liệu tài chính; sửa toàn bộ lỗi phát hiện.

## 10. Tiêu chí nghiệm thu

- Hủy booking có lựa chọn tạo đúng một case và chưa xếp hàng hoàn toàn bộ.
- Hủy booking không có lựa chọn xếp hàng hoàn 100% như trước.
- Khách khác không xem hoặc quyết định case.
- Lựa chọn không còn kho trả `409`, không trừ tiền/không tạo booking dở.
- Hai request accept đồng thời chỉ một request thành công.
- Accept tạo reservation, booking, payment ledger và đủ QR mới.
- Giá mới rẻ hơn tạo đúng một refund chênh lệch; retry không tạo giao dịch trùng.
- Decline/timeout tạo đúng một refund toàn bộ; retry idempotent.
- Booking thay thế bị hủy lần nữa vẫn hoàn đúng giá trị còn lại từ VNPay gốc, không hoàn trùng và không đóng booking nguồn quá sớm.
- Khách hủy vé thay thế đúng hạn tạo yêu cầu trên VNPay nguồn, staff từ chối thì vé/QR được khôi phục; staff duyệt thì kho, reservation, booking và QR của vé thay thế cùng được đóng.
- QR cũ không check-in được; QR mới check-in được.
- Các số kho không âm và tổng `booked + held <= capacity`.
- UI dùng được ở desktop/mobile, keyboard, loading/empty/error/realtime states.
- Test tự động và E2E trình duyệt thật đều đạt.
