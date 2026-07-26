# Hướng dẫn luyện demo nghiệp vụ Admin — VietTicket Travel

Tài liệu này dành cho thành viên trình bày vai trò Admin. Mục tiêu là giúp bạn nói đúng bản chất nghiệp vụ, đi hết các màn hình quản trị và trả lời được câu hỏi phản biện mà chưa cần thay đổi dữ liệu trong lúc luyện tập.

## 1. Cách dùng tài liệu trong buổi tập

Trong giai đoạn luyện nói hiện tại, chỉ thực hiện các thao tác an toàn sau:

- Mở trang, chuyển menu và cuộn nội dung.
- Chuyển kỳ tuần/tháng/năm.
- Tìm kiếm, lọc trạng thái và mở cửa sổ chi tiết.
- Đọc thông tin, đóng modal bằng nút đóng hoặc nút quay lại.
- Không xác nhận bất kỳ modal nghiệp vụ nào.

Không bấm các nút làm thay đổi dữ liệu:

- Phê duyệt, từ chối, đình chỉ, khôi phục hoặc tạm ẩn.
- Khóa/mở khóa tài khoản hoặc tạo nhân viên.
- Tạo/sửa danh mục, voucher hoặc tỷ lệ hoa hồng.
- Duyệt đối soát, ghi nhận chuyển khoản hoặc hủy kỳ đối soát.
- Ẩn/hiện lại đánh giá.
- Xử lý hoàn tiền, support hoặc check-in.

Nếu lỡ mở một modal hành động, bấm `Hủy`, `Quay lại`, nút đóng hoặc vùng nền. Không nhập rồi xác nhận.

## 2. Tư duy xuyên suốt của vai trò Admin

Thông điệp trung tâm cần giữ trong toàn bộ phần trình bày:

> Admin là lớp quản trị và kiểm soát nền tảng. Admin không sửa trạng thái tùy ý mà làm việc qua workflow, điều kiện chuyển trạng thái, lý do bắt buộc, phân quyền và audit log. Các nghiệp vụ tuyến đầu như check-in, support và hoàn tiền được tách cho đúng loại nhân viên, dù Admin có quyền giám sát khi cần.

Ba nguyên tắc nên nhắc lại ở các màn hình phù hợp:

1. **Phân quyền:** Customer, Partner, nhân viên cổng, nhân viên nền tảng và Admin có phạm vi khác nhau.
2. **Snapshot:** Giá, chính sách hoàn, hoa hồng và thông tin đối soát quan trọng được chụp tại thời điểm phát sinh; thay đổi cấu hình sau này không làm sai lịch sử.
3. **Truy vết:** Hành động nhạy cảm phải có actor, đối tượng, thời gian và metadata nghiệp vụ trong audit log.

## 3. Bản đồ chức năng Admin

| Thứ tự | Màn hình | Route | Chức năng chính | An toàn khi tập |
|---:|---|---|---|---|
| 1 | Tổng quan | `/admin` | KPI, dòng tiền, KYC/địa điểm chờ duyệt, forecast | Có |
| 2 | Đặt vé & Thanh toán | `/admin/bookings` | Theo dõi vòng đời booking, payment, QR và hoàn bắt buộc | Có nếu chỉ lọc/xem |
| 3 | Báo cáo tài chính | `/admin/reports` | Dòng tiền, doanh thu ghi nhận, hoa hồng, giao dịch | Có nếu không lưu tỷ lệ |
| 4 | Đối soát đối tác | `/admin/settlements` | DRAFT → APPROVED → PAID | Có nếu không xác nhận |
| 5 | Duyệt hồ sơ KYC | `/admin/kyc-approval` | Duyệt/từ chối KYC, đình chỉ/khôi phục Partner | Có nếu chỉ xem |
| 6 | Duyệt địa điểm | `/admin/attraction-approval` | Kiểm tra snapshot và duyệt/từ chối địa điểm | Có nếu chỉ xem |
| 7 | Quản lý vi phạm | `/admin/violations` | Tạm ẩn/khôi phục địa điểm | Có nếu không xác nhận |
| 8 | Quản lý danh mục | `/admin/categories` | Taxonomy dùng chung cho catalog và AI | Có nếu không lưu/xóa |
| 9 | Quản lý voucher | `/admin/vouchers` | Điều kiện ưu đãi, hạn dùng và lượt sử dụng | Có nếu không lưu/bật tắt |
| 10 | Kiểm duyệt đánh giá | `/admin/reviews` | Ẩn/hiện đánh giá theo chính sách | Có nếu không xác nhận |
| 11 | Quản lý người dùng | `/admin/users` | Tìm/lọc, khóa tài khoản, mời platform staff | Có nếu chỉ xem |
| 12 | Nhật ký kiểm toán | `/admin/audit-logs` | Truy vết hành động nhạy cảm | Có |

Admin còn thấy nhóm `Công cụ nhân viên`: check-in, support và hoàn tiền. Đây là quyền giám sát/ứng cứu; khi trình bày nên nhấn mạnh nghiệp vụ thường ngày vẫn do đúng nhóm nhân viên đảm nhiệm.

## 4. Kịch bản chi tiết từng màn hình

### 4.1. Mở đầu tại Tổng quan

Route: `/admin`

Thao tác khi tập:

1. Chỉ vào tiêu đề `Tổng quan hệ thống`.
2. Chuyển thử `Tuần`, `Tháng`, `Năm` rồi quay về `Tháng`.
3. Chỉ lần lượt các thẻ KPI.
4. Chỉ biểu đồ tiền thu, danh sách KYC chờ xử lý và địa điểm chờ duyệt.
5. Cuộn xuống forecast, không bấm `Tạo lại dự báo` khi không cần thiết.

Lời thoại đầy đủ:

> Đây là dashboard điều hành toàn nền tảng. Kỳ báo cáo có thể đổi theo tuần, tháng hoặc năm và được tính theo thời điểm cổng thanh toán ghi nhận giao dịch. Nhóm tách rõ tiền cổng đã thu, tiền hoàn thành công, dòng tiền thuần và hoa hồng đã ghi nhận; vì bốn đại lượng này không có cùng ý nghĩa kế toán.

> Admin cũng theo dõi số booking phát sinh trong kỳ, số điểm thực sự đang hoạt động, hồ sơ KYC đang chờ và giao dịch cần đối soát. Các thẻ KYC và địa điểm chờ duyệt là hàng đợi công việc, không phải chỉ số trang trí.

Giải thích chính xác các KPI:

| KPI | Cách hiểu đúng |
|---|---|
| Tổng tiền cổng đã thu | Tổng payment thành công được cổng ghi nhận trong kỳ |
| Tiền hoàn thành công | Tổng refund transaction đã thành công trong kỳ |
| Dòng tiền thuần | Tiền cổng đã thu trừ tiền hoàn thành công |
| Hoa hồng đã ghi nhận | Hoa hồng của dịch vụ đã đủ điều kiện ghi nhận, không phải của mọi booking mới tạo |
| Booking trong kỳ | Số booking vận hành được tạo trong kỳ, không gồm mẫu huấn luyện forecast |
| Điểm đang hoạt động | Điểm đã duyệt, Partner hợp lệ, trạng thái vận hành ACTIVE và đang công khai bán |
| KYC đang chờ | Hồ sơ Partner cần Admin xét duyệt |
| Giao dịch cần đối soát | Yêu cầu hoàn còn kết quả gateway chưa chắc chắn hoặc thất bại cần xử lý |

Không nói: “Doanh thu là tổng giá trị tất cả booking”. Booking chờ thanh toán, bị hủy hoặc chưa hoàn tất không được coi giống giao dịch đã ghi nhận.

#### Forecast trên dashboard

Thao tác khi tập:

1. Chỉ nhãn `Dự báo có kiểm soát`.
2. Chỉ tổng dự báo, số địa điểm đủ cơ sở và phương pháp.
3. Chỉ dòng `Mô hình ước tính thử nghiệm` và phần cảnh báo.

Lời thoại:

> Forecast ước tính doanh thu vé thuần theo ngày sử dụng dịch vụ, không phải cam kết doanh thu. Hệ thống chỉ dự báo cho địa điểm đạt ngưỡng lịch sử; điểm thiếu dữ liệu tự động bị loại khỏi tổng. Dữ liệu đầu vào chỉ lấy booking COMPLETED hoặc NO_SHOW đã thanh toán, bỏ thanh toán trùng và trừ refund.

> Mô hình thử nghiệm dùng chuỗi lịch sử có kiểm soát và được cách ly khỏi booking, KPI, báo cáo tài chính, vé, support và đối soát. Vì vậy dữ liệu phục vụ thuật toán không thể làm phồng số liệu vận hành mà Admin đang xem.

Nếu bị hỏi “Tại sao không dự báo tất cả địa điểm?” hãy trả lời:

> Điểm mới không có đủ lịch sử thì không có cơ sở thống kê. Hiển thị “chưa đủ dữ liệu” trung thực hơn tạo ra một con số giả.

### 4.2. Đặt vé & Thanh toán

Route: `/admin/bookings`

Thao tác khi tập:

1. Chỉ bốn thẻ: tổng booking, doanh thu gộp đủ điều kiện, chờ Partner duyệt, hoàn bắt buộc.
2. Mở bộ lọc trạng thái và đọc các trạng thái, nhưng không cần thay đổi dữ liệu.
3. Lọc thử `Chờ đối tác duyệt`, `Chờ hoàn tiền`, `Đã hoàn thành`, `Không đến sử dụng`.
4. Bật/tắt `Chỉ đơn hoàn bắt buộc`.
5. Mở `Chi tiết` một booking, chỉ thông tin khách, sản phẩm, ngày/khung giờ, payment, voucher và QR rồi đóng modal.

Lời thoại:

> Đây là màn theo dõi booking toàn sàn. Booking status và payment status là hai trục khác nhau: một đơn có thể đã thu tiền nhưng còn chờ Partner xác nhận; hoặc bị Partner từ chối và chuyển sang hàng đợi hoàn bắt buộc.

> Mã đơn hiển thị dạng nghiệp vụ `VT-…`; UUID nội bộ không được đưa ra cho người dùng. Chi tiết booking lưu snapshot tên địa điểm, loại vé, đơn giá, voucher, ngày/khung giờ và hoa hồng tại thời điểm mua. Partner thay giá sau đó không làm thay đổi hóa đơn cũ.

Vòng đời cần nhớ:

```text
PENDING_PAYMENT
  └─ thanh toán thành công ─► PENDING_PARTNER hoặc CONFIRMED
                                  ├─ Partner duyệt ─► CONFIRMED
                                  └─ Partner từ chối ─► CANCELLED + refundRequired

CONFIRMED
  ├─ có vé được sử dụng / kết thúc dịch vụ ─► COMPLETED
  ├─ không có vé sử dụng sau dịch vụ ─► NO_SHOW
  ├─ yêu cầu hoàn ─► REFUND_REQUESTED ─► REFUNDED
  └─ hủy hợp lệ ─► CANCELLED
```

Giải thích hai trường hợp dễ bị hỏi:

- `NO_SHOW`: khách đã mua nhưng không đến. Đây vẫn là dịch vụ đã giữ năng lực phục vụ; cách ghi nhận phụ thuộc chính sách hoàn và nghiệp vụ tài chính.
- `refundRequired`: hệ thống bắt buộc tạo luồng hoàn, ví dụ Partner từ chối một booking đã thu tiền. Đây không có nghĩa tiền đã hoàn xong.

Điểm chốt:

> Trang này phục vụ giám sát và truy vết. Việc phê duyệt refund được giao cho platform staff tại workflow riêng để tránh Admin vừa xem báo cáo vừa tự ý sửa tiền.

### 4.3. Báo cáo tài chính

Route: `/admin/reports`

Thao tác khi tập:

1. Chuyển kỳ tuần/tháng/năm.
2. Chỉ tám thẻ tài chính.
3. Chỉ bảng `Dòng tiền theo kỳ`.
4. Chỉ bảng `Đối tác và hoa hồng`; không sửa hoặc lưu tỷ lệ.
5. Ở `Lịch sử giao dịch`, thử lọc Payment/Refund và trạng thái.

Lời thoại:

> Báo cáo tài chính tách dòng tiền qua cổng khỏi doanh thu đã ghi nhận. Tiền cổng đã thu cho biết tiền thực sự đi vào gateway; tiền hoàn cho biết tiền đã trả ra; dòng tiền thuần bằng hai số này bù trừ. Doanh số thuần đã ghi nhận chỉ lấy booking đủ điều kiện nghiệp vụ và đã loại refund liên quan.

> Hoa hồng và khoản phải trả Partner được tính từ commission snapshot của booking. Nếu Admin thay đổi tỷ lệ hoa hồng của Partner hôm nay, tỷ lệ mới chỉ áp dụng cho booking mới; booking cũ không bị tính lại.

Công thức nói ngắn gọn:

```text
Dòng tiền thuần = Payment SUCCESS − Refund SUCCESS

Doanh số thuần ghi nhận = Payment hợp lệ của dịch vụ đủ điều kiện − Refund nghiệp vụ

Hoa hồng nền tảng = Doanh số thuần ghi nhận × commission snapshot

Phải trả Partner = Doanh số thuần ghi nhận − hoa hồng nền tảng
```

Các trạng thái giao dịch:

- `Đang chờ`: mới được tạo, chưa có kết quả cuối.
- `Đang xử lý`: gateway hoặc worker đang xử lý.
- `Thành công`: có kết quả xác nhận.
- `Thất bại`: gateway trả thất bại rõ ràng.
- `Cần đối soát`: chưa thể kết luận chắc chắn; không được tự coi là thành công hay thất bại.

Nếu thấy nhãn `Thanh toán trùng`, nói:

> Giao dịch trùng vẫn là dòng tiền gateway cần đối soát nhưng không được tính thành doanh số bán vé lần hai.

### 4.4. Đối soát đối tác

Route: `/admin/settlements`

Thao tác khi tập:

1. Chỉ các thẻ Nháp, Chờ chuyển khoản, Đã chuyển khoản, Đã hủy.
2. Lọc từng trạng thái.
3. Chỉ một dòng và giải thích số booking, doanh số thuần, hoa hồng, phải trả, ngân hàng đã che số.
4. Có thể mở modal `Lập kỳ đối soát` để xem trường Partner và khoảng ngày, sau đó bấm `Hủy`.
5. Không bấm duyệt, ghi nhận chuyển khoản hoặc hủy kỳ.

Lời thoại:

> Đối soát chốt công nợ giữa nền tảng và Partner theo một khoảng ngày. Khi lập kỳ, hệ thống chỉ lấy booking đã hoàn tất hoặc no-show, đã thu tiền, chưa bị đưa vào một kỳ đối soát khác và không phải mẫu huấn luyện forecast.

> Số tiền dùng snapshot hoa hồng và snapshot tài khoản ngân hàng để thay đổi hồ sơ Partner sau này không làm sai chứng từ đã chốt. Quy trình là Nháp, Đã duyệt, rồi Đã chuyển khoản. Mã tham chiếu ngân hàng bắt buộc và duy nhất để truy vết.

Luồng trạng thái:

```text
DRAFT ──duyệt──► APPROVED ──ghi mã ngân hàng──► PAID
   └────────────── hủy có lý do ──────────────► CANCELLED
```

Không nói: “Bấm PAID là hệ thống tự chuyển tiền ngân hàng”. Giao diện hiện ghi nhận kết quả chuyển khoản và mã tham chiếu; việc tích hợp banking production là một lớp khác.

### 4.5. Duyệt hồ sơ KYC Partner

Route: `/admin/kyc-approval`

Thao tác khi tập:

1. Lọc `Chờ duyệt`.
2. Mở chi tiết một hồ sơ.
3. Chỉ tên pháp lý, mã số thuế, đại diện, ngân hàng, giấy phép và bằng chứng đồng ý KYC.
4. Đóng modal, không phê duyệt hoặc từ chối.
5. Lọc `Đã phê duyệt` và `Đã đình chỉ` để giải thích trạng thái.

Lời thoại:

> Partner không được bán hàng chỉ bằng việc tạo tài khoản. Admin phải kiểm tra pháp nhân, mã số thuế, người đại diện, tài khoản ngân hàng, giấy phép và bằng chứng người dùng đồng ý gửi hồ sơ KYC.

> Tài liệu KYC nằm trong vùng lưu trữ riêng. Backend kiểm tra trusted origin và quyền sở hữu file; Admin không duyệt một URL tùy ý từ Internet. Nút phê duyệt chỉ khả dụng khi hồ sơ có đủ tài liệu và bằng chứng cần thiết.

> Từ chối phải có lý do để Partner biết phần cần sửa. Đình chỉ khác với từ chối KYC: đình chỉ dừng quyền quản lý và lượt bán mới của một Partner đã được duyệt, nhưng các vé đã xác nhận vẫn phải được phục vụ.

Phân biệt trạng thái:

- `PENDING`: đang chờ xét.
- `APPROVED`: Partner được phép vận hành theo phạm vi hệ thống.
- `REJECTED`: hồ sơ chưa đạt và có lý do.
- `SUSPENDED`: Partner từng được duyệt nhưng đang bị đình chỉ vận hành.

### 4.6. Duyệt địa điểm

Route: `/admin/attraction-approval`

Thao tác khi tập:

1. Lọc `Chờ duyệt`.
2. Mở chi tiết một địa điểm.
3. Chỉ ảnh, địa chỉ, tọa độ, danh mục, giờ mở cửa, mô tả, gói vé và lịch.
4. Chỉ hai nút duyệt/từ chối rồi đóng modal.

Lời thoại:

> Partner gửi một phiên bản địa điểm để xét duyệt. Admin duyệt snapshot của phiên bản đó, gồm nội dung, ảnh, danh mục, giá/gói vé và lịch; không duyệt một bản ghi đang bị Partner thay đổi ngầm trong cùng thời điểm.

> Backend vẫn kiểm tra điều kiện, ví dụ danh mục còn hoạt động, snapshot đủ trường và Partner hợp lệ. Nếu từ chối, lý do bắt buộc giúp Partner sửa đúng vấn đề rồi gửi lại.

Phân biệt với `Quản lý vi phạm`:

- Duyệt địa điểm quyết định nội dung có đạt chuẩn xuất bản hay không.
- Quản lý vi phạm xử lý một địa điểm đã được duyệt nhưng phát sinh vấn đề trong vận hành.

### 4.7. Quản lý vi phạm và ba lớp trạng thái

Route: `/admin/violations`

Thao tác khi tập:

1. Lọc `Đang hoạt động`, `Đang tạm dừng`, `Bị đình chỉ`.
2. Chỉ nút `Tạm ẩn` nhưng không xác nhận.
3. Mở modal của một địa điểm, chỉ trường lý do rồi hủy.
4. Chỉ nút `Khôi phục` của địa điểm đã ẩn nhưng không bấm.

Lời thoại:

> Hệ thống tách ba lớp trạng thái để Admin không vô tình thay Partner quyết định kinh doanh. Trạng thái duyệt trả lời nội dung có đạt chuẩn; trạng thái vận hành trả lời nền tảng có cho phép phục vụ; trạng thái phát hành trả lời Partner có đang mở bán công khai.

| Lớp | Ví dụ | Ai chịu trách nhiệm chính |
|---|---|---|
| Nội dung | `APPROVED`, `REJECTED` | Admin duyệt nội dung |
| Vận hành | `ACTIVE`, `SUSPENDED` | Admin kiểm soát an toàn/vi phạm |
| Phát hành | `ACTIVE`, `PAUSED` | Partner quyết định mở bán |

> Khi Admin tạm ẩn, địa điểm biến mất khỏi catalog công khai và lý do được lưu. Khi Admin khôi phục, trạng thái vận hành trở lại ACTIVE nhưng phát hành vẫn PAUSED; Partner phải kiểm tra rồi chủ động mở bán lại. Đây là tách trách nhiệm, không phải lỗi đồng bộ.

### 4.8. Quản lý danh mục

Route: `/admin/categories`

Thao tác khi tập:

1. Chỉ ba thống kê: tổng danh mục, đang hiển thị, lượt gắn địa điểm.
2. Lọc đang hiển thị/đang ẩn.
3. Chỉ form tên, mô tả, biểu tượng và trạng thái; không lưu.
4. Chỉ nút xóa bị vô hiệu khi danh mục đang được dùng.

Lời thoại:

> Danh mục là taxonomy dùng chung cho form tạo địa điểm, bộ lọc public và tiêu chí của trợ lý gợi ý. Ẩn danh mục sẽ ngăn chọn mới nhưng không phá dữ liệu lịch sử. Danh mục đã có địa điểm sử dụng không được xóa để bảo toàn khóa tham chiếu.

Không nói: “Danh mục chỉ là text hiển thị”. Nó là dữ liệu chuẩn hóa dùng ở nhiều module.

### 4.9. Quản lý voucher

Route: `/admin/vouchers`

Thao tác khi tập:

1. Tìm một voucher và chỉ trạng thái, hạn dùng, số lượt dùng.
2. Chỉ form tạo voucher: mã, loại giảm, giá trị, trần giảm, đơn tối thiểu, hạn và giới hạn lượt.
3. Mở chỉnh sửa một voucher đã dùng để chỉ các trường tài chính bị khóa, sau đó `Hủy chỉnh sửa`.
4. Không bật/tắt hoặc lưu.

Lời thoại:

> Voucher hỗ trợ giảm theo phần trăm hoặc số tiền cố định. Với phần trăm có thể đặt trần giảm; cả hai loại có thể yêu cầu giá trị đơn tối thiểu, thời hạn, số lượt dùng và trạng thái bật/tắt.

> Sau khi voucher đã được sử dụng, mã và điều kiện tài chính bị khóa. Admin chỉ có thể điều chỉnh hạn, giới hạn lượt hợp lệ hoặc trạng thái. Quy tắc này ngăn sửa chính sách làm sai lịch sử booking đã thanh toán.

Trạng thái hiển thị:

- Đang áp dụng.
- Đã tắt.
- Hết hạn.
- Hết lượt.

### 4.10. Kiểm duyệt đánh giá

Route: `/admin/reviews`

Thao tác khi tập:

1. Chỉ thống kê và bộ lọc số sao.
2. Tìm theo bình luận, khách hoặc địa điểm.
3. Chỉ đánh giá đang hiển thị và đã ẩn.
4. Mở modal `Ẩn vi phạm`, chỉ trường lý do tối thiểu 10 ký tự rồi hủy.

Lời thoại:

> Partner có quyền phản hồi đánh giá nhưng không được tự xóa ý kiến bất lợi. Admin hoặc platform staff chỉ ẩn nội dung vi phạm chính sách, phải nhập lý do; đánh giá không bị xóa khỏi cơ sở dữ liệu nên vẫn truy vết và có thể hiển thị lại.

> Điểm số thấp không phải lý do để ẩn. Lý do hợp lệ phải liên quan đến chính sách như công kích cá nhân, lộ thông tin nhạy cảm hoặc nội dung không liên quan.

Nếu bị hỏi “Sao không xóa luôn?”:

> Xóa vật lý làm mất bằng chứng kiểm duyệt. Ẩn mềm bảo vệ giao diện công khai nhưng vẫn giữ lịch sử và audit.

### 4.11. Quản lý người dùng và nhân viên nền tảng

Route: `/admin/users`

Thao tác khi tập:

1. Chỉ thống kê tài khoản.
2. Tìm theo tên/email; lọc Customer, Partner, Admin, Staff và Active/Locked.
3. Chỉ nút khóa/mở khóa; không bấm.
4. Chỉ việc Admin không thể tự khóa chính mình.
5. Mở modal `Thêm nhân viên nền tảng` để đọc phạm vi quyền rồi đóng.

Lời thoại:

> Admin quản lý quyền truy cập chứ không sửa lịch sử giao dịch của người dùng. Khóa tài khoản ngăn đăng nhập nhưng không xóa booking, payment, review hay audit liên quan.

> Hệ thống chặn Admin tự khóa chính mình. Nhân viên nền tảng được tạo qua lời mời và có quyền xử lý CSKH, hoàn tiền, kiểm duyệt đánh giá; nhân viên Partner là nhóm khác, do Partner quản lý và chỉ làm trong phạm vi điểm được phân công.

Nếu hỏi “Tại sao khóa thay vì xóa?”:

> Nền tảng thương mại phải giữ chứng từ và quan hệ dữ liệu. Khóa là hành động có thể phục hồi; xóa tài khoản có thể phá lịch sử và nghĩa vụ đối soát.

### 4.12. Nhật ký kiểm toán

Route: `/admin/audit-logs`

Thao tác khi tập:

1. Tìm theo hành động, mã đối tượng hoặc nhân viên.
2. Lọc loại đối tượng.
3. Chỉ các cột thời gian, actor, hành động, đối tượng và chi tiết.
4. Tìm ví dụ KYC, địa điểm, review, check-in, cấp lại vé hoặc settlement nếu đang có.

Lời thoại:

> Audit log trả lời bốn câu hỏi: ai làm, làm gì, trên đối tượng nào và lúc nào. Metadata chỉ hiển thị các trường nghiệp vụ đã được đặt nhãn, ví dụ lý do, trạng thái mới, mã tham chiếu hoặc số tiền; giao diện không phơi JSON kỹ thuật không cần thiết.

> Các hành động như duyệt/từ chối KYC, duyệt/ẩn địa điểm, khóa tài khoản, check-in, cấp lại vé, hoàn tiền và đối soát đều tạo dấu vết. Từ giao diện vận hành thông thường không có chức năng sửa hoặc xóa audit log.

Không tuyên bố audit log “không thể bị sửa trong mọi tình huống”. Câu chính xác là: người dùng nghiệp vụ không có luồng sửa/xóa; việc chống can thiệp cấp cơ sở dữ liệu cần thêm hạ tầng immutable/WORM trong production nếu yêu cầu pháp lý bắt buộc.

### 4.13. Công cụ nhân viên mà Admin có thể giám sát

Admin nhìn thấy:

- `/staff/checkin`: tra cứu/check-in/cấp lại vé theo phạm vi điểm.
- `/staff/tickets`: tiếp nhận, phản hồi và đóng support ticket.
- `/staff/refunds`: xử lý yêu cầu hoàn tiền và kết quả gateway.

Lời thoại nếu giảng viên hỏi:

> Admin có quyền giám sát hoặc xử lý tình huống khẩn cấp, nhưng luồng thường ngày vẫn được giao cho đúng loại staff. Nhân viên cổng chỉ xử lý check-in tại điểm được phân công; platform staff xử lý support, refund và moderation. Phân quyền backend mới là lớp quyết định, không dựa vào việc ẩn menu.

Không cần mở ba màn này trong phần Admin 9–10 phút nếu thành viên trước đã trình bày staff.

### 4.14. Cài đặt và đăng xuất

Ở cuối sidebar:

- `Cài đặt` mở hồ sơ tài khoản hiện tại.
- `Đăng xuất` gọi logout rồi điều hướng về trang đăng nhập.
- Khu vực hồ sơ cho biết đúng tên và vai trò hiện tại.

Lời thoại ngắn:

> Điều hướng được cố định theo vai trò; Admin đăng nhập đi vào cổng quản trị và đăng xuất trực tiếp từ sidebar.

## 5. Bài luyện nói chỉ đọc — 15 phút

Không thay đổi dữ liệu. Bật đồng hồ và tập theo thứ tự:

| Thời gian | Màn hình | Nội dung bắt buộc |
|---:|---|---|
| 0:00–0:40 | Tổng quan | Vai trò Admin và ba nguyên tắc workflow/snapshot/audit |
| 0:40–2:20 | Tổng quan | KPI tiền, hàng đợi duyệt và forecast có kiểm soát |
| 2:20–3:40 | Booking | Payment khác booking, trạng thái và refundRequired |
| 3:40–5:10 | Tài chính | Dòng tiền khác doanh thu ghi nhận, commission snapshot |
| 5:10–6:15 | Đối soát | DRAFT → APPROVED → PAID và mã ngân hàng |
| 6:15–7:35 | KYC | Pháp nhân, tài liệu private, approve/reject/suspend |
| 7:35–8:45 | Duyệt địa điểm | Snapshot và validation trước duyệt |
| 8:45–10:00 | Vi phạm | Ba lớp trạng thái và lý do khôi phục vẫn PAUSED |
| 10:00–10:45 | Danh mục | Taxonomy dùng chung, không xóa khi đang dùng |
| 10:45–11:35 | Voucher | Điều kiện ưu đãi và khóa điều khoản sau khi đã dùng |
| 11:35–12:25 | Review | Chỉ ẩn vi phạm, Partner không tự xóa review xấu |
| 12:25–13:30 | User | Khóa thay xóa, không tự khóa, platform staff |
| 13:30–14:35 | Audit | Ai–làm gì–đối tượng–thời gian |
| 14:35–15:00 | Kết luận | Vòng đời khép kín và kiểm soát dữ liệu |

Sau khi nói trôi chảy 15 phút, rút xuống bản chính 9–10 phút bằng cách chỉ mở chi tiết ở KYC, địa điểm, vi phạm, review và settlement; các màn danh mục/voucher/user chỉ nói một câu rồi chuyển.

## 6. Bản lời thoại 9–10 phút dùng khi demo thật

### Mở đầu — 20 giây

> Phần của em trình bày lớp quản trị nền tảng. Admin không sửa trạng thái tùy ý mà thao tác qua workflow, điều kiện hợp lệ, lý do bắt buộc và audit log. Em sẽ đi từ giám sát booking–tài chính đến kiểm duyệt Partner, nội dung và đối soát.

### Dashboard và booking — 90 giây

> Dashboard tách tiền cổng đã thu, tiền hoàn, dòng tiền thuần và hoa hồng ghi nhận. Booking trong kỳ không bao gồm lịch sử huấn luyện forecast. Forecast chỉ chạy cho điểm đủ dữ liệu và được ghi rõ là ước tính, không phải cam kết.

> Ở danh sách booking, payment và booking là hai trạng thái riêng. Đơn có thể đã thu tiền nhưng chờ Partner duyệt; nếu Partner từ chối thì booking bị hủy và hệ thống tạo hoàn tiền bắt buộc. Chi tiết giữ snapshot giá, voucher, chính sách và hoa hồng để dữ liệu cũ không đổi theo cấu hình mới.

### Tài chính và đối soát — 100 giây

> Báo cáo phân biệt dòng tiền gateway với doanh thu đã ghi nhận. Commission snapshot bảo vệ booking cũ; thay tỷ lệ hôm nay chỉ áp dụng booking mới. Giao dịch trùng vẫn được theo dõi để đối soát nhưng không thành doanh số lần hai.

> Đối soát chỉ lấy booking đủ điều kiện và chưa thuộc kỳ khác. Quy trình DRAFT → APPROVED → PAID, lưu snapshot ngân hàng và mã tham chiếu duy nhất. Đây là ghi nhận việc chuyển khoản, không giả lập rằng website tự chuyển tiền ngân hàng.

### KYC và địa điểm — 120 giây

> Partner phải qua KYC gồm pháp nhân, thuế, đại diện, ngân hàng, giấy phép và bằng chứng đồng ý. Tài liệu nằm trong private storage và được kiểm tra quyền sở hữu. Từ chối hoặc đình chỉ đều phải có lý do.

> Địa điểm được duyệt theo snapshot nội dung, ảnh, danh mục, vé và lịch. Backend vẫn chặn duyệt nếu snapshot thiếu trường, danh mục bị khóa hoặc Partner không hợp lệ.

### Vi phạm, review và cấu hình — 120 giây

> Hệ thống tách duyệt nội dung, trạng thái vận hành và trạng thái phát hành. Admin khôi phục một điểm bị đình chỉ chỉ đưa vận hành về ACTIVE; điểm vẫn PAUSED để Partner tự kiểm tra và mở bán lại.

> Với review, Partner chỉ phản hồi; Admin chỉ ẩn nội dung vi phạm và phải lưu lý do, không được xóa review chỉ vì điểm thấp. Danh mục đang dùng không được xóa, còn điều kiện tài chính của voucher đã dùng bị khóa để bảo toàn lịch sử.

### User, audit và kết luận — 70 giây

> Khóa tài khoản chỉ chặn truy cập, không xóa booking hay chứng từ; Admin không thể tự khóa mình. Platform staff được mời riêng và khác nhân viên Partner.

> Cuối cùng, audit log ghi actor, hành động, đối tượng, thời gian và metadata nghiệp vụ cho các thao tác nhạy cảm. Toàn bộ hệ thống tạo thành vòng kiểm soát từ Partner–catalog–booking–tiền–đối soát, thay vì các màn hình rời rạc.

## 7. Câu hỏi phản biện và câu trả lời chuẩn

### “Admin có thể sửa booking thành COMPLETED hay REFUNDED không?”

Không. Trạng thái được chuyển qua workflow nghiệp vụ: check-in/kết thúc dịch vụ, xử lý refund hoặc worker; màn Admin booking chủ yếu giám sát và truy vết.

### “Tại sao thanh toán thành công mà booking vẫn chưa xác nhận?”

Sản phẩm yêu cầu Partner xác nhận năng lực phục vụ. Payment đã thành công nhưng booking ở `PENDING_PARTNER`; nếu từ chối, hệ thống tạo hoàn bắt buộc.

### “Dòng tiền thuần và doanh thu thuần khác nhau thế nào?”

Dòng tiền thuần là tiền vào gateway trừ refund thành công trong kỳ. Doanh thu thuần ghi nhận dựa trên dịch vụ đủ điều kiện, loại giao dịch trùng và điều chỉnh refund nghiệp vụ.

### “Đổi hoa hồng có làm thay booking cũ không?”

Không. Booking giữ commission snapshot. Tỷ lệ mới chỉ áp dụng khi tạo booking mới.

### “Tại sao Admin không trực tiếp hoàn tiền từ trang booking?”

Để tách nhiệm vụ giám sát khỏi thao tác tiền. Platform staff xử lý refund trong workflow riêng; Admin có quyền giám sát và audit.

### “NO_SHOW có được trả Partner không?”

Nếu booking đã thanh toán, không có refund hợp lệ và đáp ứng điều kiện đối soát thì NO_SHOW có thể được ghi nhận, vì Partner đã giữ năng lực phục vụ. Chính sách cụ thể vẫn dựa trên snapshot booking.

### “Làm sao tránh đưa một booking vào hai kỳ đối soát?”

Backend chỉ chọn booking đủ điều kiện chưa thuộc kỳ đối soát khác còn hiệu lực và chốt bằng transaction; booking item là quan hệ có kiểm soát, không chỉ cộng số trên giao diện.

### “PAID có thật sự chuyển tiền không?”

Hiện tại là bước ghi nhận kết quả chuyển khoản cùng mã tham chiếu duy nhất. Production có thể tích hợp banking/payout API, nhưng không được mô tả sandbox như tiền thật.

### “Tại sao khôi phục địa điểm mà vẫn chưa bán?”

Admin chỉ khôi phục quyền vận hành. Publication vẫn PAUSED để Partner kiểm tra và chủ động phát hành lại; đây là tách trách nhiệm.

### “Partner có thể xóa review xấu không?”

Không. Partner chỉ phản hồi. Admin/platform staff chỉ ẩn review vi phạm có lý do; rating thấp không phải vi phạm.

### “Tại sao voucher đã dùng không sửa được phần trăm?”

Nếu sửa điều kiện tài chính, lịch sử booking sẽ không còn giải thích được. Vì vậy điều khoản cốt lõi bị khóa sau lần sử dụng đầu tiên.

### “Tại sao không xóa tài khoản bị vi phạm?”

Booking, payment, refund và audit phải được giữ. Khóa tài khoản ngăn truy cập nhưng bảo toàn chứng từ và có thể phục hồi.

### “Forecast có phải số ngẫu nhiên không?”

Không. Pipeline dùng lịch sử theo ngày, lag/rolling và validation theo thời gian. Tuy nhiên dữ liệu hiện tại là chuỗi kiểm thử có kiểm soát nên UI ghi mô hình thử nghiệm, không cam kết độ chính xác production.

### “Vì sao lịch sử forecast không xuất hiện trong booking?”

Các quan sát huấn luyện có cờ `isForecastTrainingSample` và chỉ được phép đi vào pipeline dự báo. API booking, vé, support, tài chính, đối soát và AI Assistant đều loại chúng.

### “Audit log có tuyệt đối không thể bị sửa không?”

Người dùng nghiệp vụ không có luồng sửa/xóa audit. Nếu production yêu cầu bất biến cấp pháp lý, cần thêm lưu trữ append-only hoặc WORM và kiểm soát DBA.

## 8. Những câu tuyệt đối không nên nói

| Không nên nói | Nên nói |
|---|---|
| “Đây là doanh thu thật của công ty.” | “Đây là dữ liệu vận hành có kiểm soát để trình bày workflow.” |
| “AI dự đoán chính xác doanh thu.” | “Mô hình ước tính hỗ trợ lập kế hoạch, không phải cam kết.” |
| “Admin muốn sửa trạng thái nào cũng được.” | “Backend chỉ cho chuyển trạng thái hợp lệ qua workflow.” |
| “Khôi phục là bán lại ngay.” | “Khôi phục vận hành; Partner phải phát hành lại.” |
| “PAID là website đã tự chuyển tiền.” | “PAID ghi nhận kết quả và mã tham chiếu chuyển khoản.” |
| “Review thấp thì Admin ẩn.” | “Chỉ ẩn nội dung vi phạm chính sách, có lý do.” |
| “Khóa tài khoản là xóa dữ liệu.” | “Khóa ngăn truy cập nhưng giữ chứng từ.” |
| “Payment thành công nghĩa là đã phục vụ.” | “Payment và vòng đời dịch vụ là hai trục riêng.” |

## 9. Cách xử lý tình huống khi đang trình bày

### Màn hình tải chậm

Nói:

> Dữ liệu đang được tải qua API theo phân quyền. Trong lúc chờ, em giải thích điều kiện nghiệp vụ của màn hình này.

Không refresh liên tục. Chờ 2–3 giây rồi tải lại một lần.

### Danh sách trống sau khi lọc

Nói:

> Bộ lọc hiện không có bản ghi phù hợp; hệ thống không tạo dữ liệu giả để lấp bảng. Em chuyển về Tất cả trạng thái.

### Nút bị vô hiệu

Nói:

> Nút bị khóa vì điều kiện nghiệp vụ chưa đủ, ví dụ thiếu tài liệu KYC, danh mục đang được dùng hoặc Admin đang xem chính tài khoản của mình.

### Bị hỏi một con số cụ thể

Không đoán. Chỉ vào nhãn trên màn hình và nói rõ kỳ báo cáo. Nếu cần:

> Con số này đang theo kỳ Tháng và thời điểm gateway ghi nhận; đổi kỳ sẽ thay phạm vi dữ liệu.

### Lỡ mở modal hành động

Không hoảng. Nói:

> Hệ thống yêu cầu xác nhận và lý do trước hành động nhạy cảm. Em đóng modal để không thay đổi dữ liệu trong phần giải thích.

Sau đó bấm `Hủy`.

## 10. Checklist trước khi luyện

- [ ] Đang ở đúng tài khoản Admin.
- [ ] Không mở `backend/.env` khi chia sẻ màn hình.
- [ ] Không chạy `demo:prepare` hoặc `demo:smoke` sau khi đã đăng nhập.
- [ ] Chỉ dùng tìm kiếm, bộ lọc, xem chi tiết và đóng modal.
- [ ] Nhớ bốn khái niệm tiền: captured, refunded, net cash, recognized commission.
- [ ] Nhớ ba lớp trạng thái địa điểm: duyệt, vận hành, phát hành.
- [ ] Nhớ Payment và Booking là hai trục khác nhau.
- [ ] Nhớ DRAFT → APPROVED → PAID.
- [ ] Nhớ Partner không được tự ẩn review.
- [ ] Nhớ kết luận bằng snapshot, phân quyền và audit.

## 11. Câu kết thúc nên học thuộc

> Phần Admin cho thấy hệ thống không chỉ có giao diện quản lý. Mỗi thao tác quan trọng đều bị giới hạn bởi vai trò, điều kiện trạng thái, snapshot dữ liệu tài chính và audit log. Nhờ đó vòng đời từ Partner, địa điểm, booking, thanh toán, hoàn tiền đến đối soát có thể kiểm tra và giải trình được.
