# Model Class Diagram — Chuẩn vẽ (UML 2.5.1)

Chuẩn dùng cho toàn bộ class diagram theo từng chức năng của VietTicket.
Mỗi chức năng = 1 file `.puml` + 1 file `.png` trong thư mục này.

Tên file: `[feature-slug]-model-class-diagram.puml`

## 1. Phạm vi — chỉ model, không tầng khác

Chỉ đưa vào sơ đồ model **trực tiếp** tham gia chức năng, tức là model được:
tạo mới / đọc để kiểm tra điều kiện nghiệp vụ / cập nhật trạng thái / bị xóa /
hoặc có quan hệ vòng đời trực tiếp với model trung tâm.

**Cấm** xuất hiện: Controller, Service, Repository, DAO, Servlet, Route, Middleware,
Utility, API client, DB connection, View/UI component, Request/Response DTO, Actor, Database.

**Không** vẽ enum thành class riêng (trừ khi được yêu cầu) — chỉ dùng tên enum làm kiểu:
`-role: UserRole`, `-status: UserStatus`.

Không thêm model chỉ vì nó tồn tại trong database.

## 2. Nguồn sự thật

- **Nghiệp vụ**: SDS/SRS + sequence diagram của chức năng (`docs/diagrams/<module>/*.puml`).
- **Tên model, tên thuộc tính, kiểu, nullable, default, unique, PK/FK, quan hệ, cascade**:
  `vietticket-travel/backend/prisma/schema.prisma` — đây là căn cứ chính, thắng SDS khi lệch.
- **Hành vi nghiệp vụ thật** (token có hash không, có xóa sau khi dùng không...):
  đọc controller tương ứng trong `vietticket-travel/backend/src/controllers/`.

Nếu SDS lệch source code: giữ **ý nghĩa nghiệp vụ** của SDS, dùng **tên** của source code,
và ghi rõ điểm lệch ở phần giải thích **bên ngoài** sơ đồ.

Không bịa model / thuộc tính / quan hệ. Không chắc thì ghi rõ là **giả định**.

## 3. Class

Ba phần: tên — thuộc tính — phương thức. Luôn có stereotype `<<model>>`.

## 4. Thuộc tính

Cú pháp `-tênThuộcTính: Kiểu`, mặc định **private** (`-`).

Bổ sung khi có bằng chứng:

| Ký hiệu | Ý nghĩa |
|---|---|
| `{UUID}` | khóa UUID |
| `{unique}` | ràng buộc duy nhất |
| `{hashed}` | lưu dưới dạng hash |
| `[0..1]` | nullable / optional (**không** dùng `?` nữa) |
| `= VALUE` | giá trị mặc định |

Giữ nguyên kiểu khai báo trong schema. Được giữ FK thật (`userId`, `attractionId`...).
**Không** đưa relation collection vào phần thuộc tính nếu quan hệ đó đã vẽ bằng đường nối.

Chỉ hiển thị thuộc tính mà chức năng đọc / tạo / cập nhật / dùng kiểm tra điều kiện,
cộng khóa định danh và trường trạng thái–thời gian ảnh hưởng trực tiếp.

Thứ tự: **ID → FK → nghiệp vụ chính → trạng thái → thời gian → audit**.

## 5. Phương thức

Cú pháp `+tên(tham số: Kiểu): KiểuTrả`. Static dùng `{static} +create(...): ModelName`
(PlantUML tự gạch chân).

Chỉ hành vi thuộc trách nhiệm tự nhiên của model: factory, đổi trạng thái, kiểm tra
trạng thái/quy tắc nội tại, so khớp giá trị, kết thúc vòng đời.

**Cấm**: `sendEmail()`, `findByEmail()`, `save()`, `executeQuery()`, `handleRequest()`,
`doGet()`, `doPost()`, `sendResponse()`, `connectDatabase()`. Không getter/setter máy móc.

Prisma model chỉ có dữ liệu, không có method — nên các method ở đây là **domain method đề xuất**,
suy ra từ nghiệp vụ, phải nêu rõ điều này bên ngoài sơ đồ.

Thứ tự: **static factory → đổi trạng thái → kiểm tra → kết thúc vòng đời**.

## 6. Quan hệ

| Loại | Cú pháp | Khi dùng |
|---|---|---|
| Association | `A "1" -- "0..*" B : role` | có liên hệ, không phụ thuộc vòng đời |
| Aggregation | `Whole "1" o-- "0..*" Part : parts` | chứa nhau nhưng phần vẫn tồn tại độc lập |
| Composition | `Whole "1" *-- "0..*" Part : parts` | phần phụ thuộc vòng đời vào chủ sở hữu |
| Generalization | `Child --|> Parent` | kế thừa |
| Realization | `Concrete ..|> Interface` | hiện thực interface |
| Dependency | `Client ..> Supplier` | phụ thuộc sử dụng |

- Hình thoi (rỗng/đặc) luôn nằm **phía model toàn thể/sở hữu**.
- **Một part chỉ được thuộc đúng MỘT composite.** Model con có nhiều FK (ví dụ `TicketInstance`
  trỏ tới cả `Booking` lẫn `TicketProduct`) chỉ được vẽ hình thoi đặc về phía chủ sở hữu vòng đời
  đã chỉ định; các liên kết còn lại phải là Association. Bảng chỉ định nằm ở
  `COMPOSITION_PARENT` trong [_tools/gen.py](_tools/gen.py).
- Bội số phía composite bắt buộc là `1` hoặc `0..1` — không bao giờ là `0..*`.
- Không dùng Aggregation nếu Association đã đủ nghĩa.
- **Không** kết luận Composition chỉ vì `onDelete: Cascade` — phải xét ý nghĩa vòng đời nghiệp vụ.
- **Không** dùng Dependency chỉ để thể hiện FK.
- Quan hệ tự tham chiếu (`Payment.duplicateOfPaymentId`): đầu back-reference là phía **không**
  giữ FK, nên bội số đọc là `Payment "0..1" -- "0..*" Payment : duplicatePayments`.

**Multiplicity bắt buộc ở cả hai đầu**: `1`, `0..1`, `*`/`0..*`, `1..*`, `m..n`.
Nếu DB cho phép nhiều bản ghi nhưng nghiệp vụ chỉ cho phép một bản ghi đang hoạt động,
ghi multiplicity theo **phạm vi chức năng** và giải thích bên ngoài sơ đồ.

**Tên quan hệ** phải là role name rõ nghĩa, khớp source code (`profile`, `roleMemberships`,
`emailVerificationToken`, `bookingItems`). Tránh `data`, `object`, `item`, `token`.

## 7. Template PlantUML

```plantuml
@startuml
title [TÊN CHỨC NĂNG] - Model Class Diagram

skinparam backgroundColor #FFFFFF
skinparam shadowing false
skinparam roundCorner 0
skinparam dpi 180
skinparam defaultFontName Arial
skinparam classFontName Arial
skinparam classAttributeFontName Consolas
skinparam classAttributeIconSize 0
skinparam classBorderColor #263238
skinparam classBackgroundColor #FAFCFD
skinparam classHeaderBackgroundColor #DCEEF8
skinparam ArrowColor #263238
skinparam ArrowThickness 1.2
skinparam linetype ortho
skinparam nodesep 120
skinparam ranksep 90
hide circle
@enduml
```

`skinparam classAttributeIconSize 0` + `hide circle` là bắt buộc — để hiện `-`/`+`
thay vì icon tròn/vuông màu của PlantUML.

## 8. Bố cục

Model trung tâm ở vị trí dễ nhận biết, model phụ thuộc đặt gần. Hạn chế đường cắt nhau.
Không để chữ đè lên class / thuộc tính / phương thức / đường nối, không để nội dung bị cắt.

Khi nhãn quan hệ bị chồng chữ, xử lý theo thứ tự: đổi hướng bố cục (bỏ/thêm
`left to right direction`) → tăng `nodesep`/`ranksep` → rút gọn nhãn → bỏ nhãn nếu tên
hai model đã đủ rõ. Rút gọn chữ ký method nếu class bị quá rộng.

Tên class/thuộc tính/method bằng **tiếng Anh**, khớp source code. Không icon trang trí.

## 9. Render

```bash
java "-Dfile.encoding=UTF-8" -jar "docs/diagrams/plantuml.jar" -charset UTF-8 -tpng "docs/diagrams/class_diagrams/[feature-slug]-model-class-diagram.puml"
```

PowerShell dùng nháy đơn: `java '-Dfile.encoding=UTF-8' -jar 'docs\diagrams\plantuml.jar' -charset UTF-8 -tpng '...'`

**Bắt buộc mở ảnh PNG kiểm tra trực quan** sau khi render, sửa và render lại đến khi đạt.

## 10. Checklist trước khi giao

- [ ] Chỉ có model trực tiếp liên quan chức năng
- [ ] Không có Controller / Service / Repository / DAO / DTO
- [ ] Mỗi model đủ 3 phần: tên, thuộc tính, phương thức
- [ ] Thuộc tính dùng `-`, phương thức dùng `+`
- [ ] Method static được gạch chân
- [ ] Không có icon tròn/vuông visibility
- [ ] Kiểu dữ liệu, optionality, default khớp `schema.prisma`
- [ ] Quan hệ đúng ngữ nghĩa; hình thoi ở phía model sở hữu
- [ ] Multiplicity ở **cả hai** đầu; tên quan hệ rõ nghĩa
- [ ] Không chồng chữ / không bị cắt nội dung; ảnh đủ nét
- [ ] `.puml` biên dịch thành công; PNG đã được mở kiểm tra

Bốn script kiểm tra trong `_tools/`, chạy hết trước khi giao:

| Script | Kiểm gì |
|---|---|
| `audit.py` | cú pháp UML, kiểu dữ liệu, ngữ nghĩa quan hệ, multiplicity |
| `strict.py` | chất lượng mô hình: setter trá hình, lớp toàn khóa, trùng tên, enum sai |
| `final.py` | file rác, nhất quán tên/số/module, chữ ký method, phủ đủ SDS |
| `geom.py` | **đo hình học trên bản SVG**: chồng chữ, nhãn đè khung, chữ tràn canvas |

`geom.py` dùng `textLength` mà PlantUML ghi trong SVG nên đo chính xác từng pixel — đáng tin hơn
nhìn mắt. Sơ đồ nào còn chồng chữ thì dùng `try_layout.py <ten-file.puml>` để thử các biến thể bố
cục, rồi ghi biến thể sạch vào `layout` trong `curated.json`.

Chi tiết `audit.py` — 12 nhóm quy tắc: cú pháp
thuộc tính/phương thức, tham số thiếu kiểu, kiểu trả về, tên và kiểu đối chiếu `schema.prisma`,
multiplicity hợp lệ và khớp schema ở **cả hai đầu**, role name khớp back-reference của Prisma,
hình thoi đúng phía, một part chỉ một composite, và quan hệ bị thiếu giữa hai lớp có FK trực tiếp.

## 11. Định dạng phản hồi khi giao kết quả

1. Model được chọn + lý do — 2. Thành phần bị loại — 3. Giả định & điểm lệch SDS/source
— 4. Mã PlantUML — 5. Đường dẫn `.puml` — 6. Đường dẫn `.png` — 7. Hiển thị ảnh
— 8. Giải thích quan hệ & multiplicity.

## 12. Diagram đã có — 107 sơ đồ / 108 chức năng / 9 module

Sinh từ `Group5_VietTicketTravel_SDS_final.docx` (mục **II. Code Designs**), đối chiếu
`schema.prisma`. Mỗi module có một thư mục riêng chứa `.puml` + `.png` + `README.md` chỉ mục.

| # | Module | Số chức năng | Thư mục |
|---|---|---|---|
| 1 | Authentication and User Account | 13 | [01_auth_user_account](01_auth_user_account/README.md) |
| 2 | Public Attraction Discovery, Favorites, and Reviews | 11 | [02_attraction_discovery_reviews](02_attraction_discovery_reviews/README.md) |
| 3 | Partner Profile and Attraction Management | 16 | [03_partner_attraction_management](03_partner_attraction_management/README.md) |
| 4 | Ticket Product, Schedule, and Reservation | 11 | [04_ticket_product_reservation](04_ticket_product_reservation/README.md) |
| 5 | Booking, Payment, and Refund | 13 | [05_booking_payment_refund](05_booking_payment_refund/README.md) |
| 6 | Staff Operations and Partner Staff Management | 15 | [06_staff_operations](06_staff_operations/README.md) |
| 7 | Support and Realtime Messaging | 6 | [07_support_messaging](07_support_messaging/README.md) |
| 8 | Admin Management and Moderation | 14 | [08_admin_moderation](08_admin_moderation/README.md) |
| 9 | AI Assistant, Weather, and Newsletter | 8 | [09_ai_weather_newsletter](09_ai_weather_newsletter/README.md) |

**9.8 Weather Forecast không có sơ đồ** — chức năng này gọi API thời tiết bên ngoài và không
đọc/ghi model lưu trữ nào, nên vẽ class diagram sẽ ra sơ đồ rỗng. Trong SDS, chỗ placeholder của
mục này được thay bằng một dòng giải thích thay vì ảnh.

Tên file: `<mục SDS>_<feature-slug>-model-class-diagram.png`, ví dụ
`1_2_verify-email-model-class-diagram.png` ứng với mục **1.2 Verify Email** trong SDS.

## 13. Giả định chung áp dụng cho cả 108 sơ đồ

1. **Method là "domain method đề xuất".** Prisma model chỉ chứa dữ liệu; các method trong sơ đồ
   được suy ra từ thao tác nghiệp vụ trong bảng *Database Queries* của SDS (`create` → static
   factory, `update` → method đổi trạng thái tương ứng đúng field bị ghi, `delete` → method kết
   thúc vòng đời, `find*` → method kiểm tra). Chúng chưa được cài đặt trực tiếp trong model.
2. **Phạm vi model** lấy từ dòng *Prisma Models* của SDS, chỉ giữ model thực sự xuất hiện trong
   bảng *Database Queries* của chức năng đó. Model chỉ do middleware `protect`/`requirePartner`
   nạp (thường là `AuthSession`, `PartnerProfile`) bị loại theo quy tắc mục 1.
3. **Tên và kiểu thuộc tính** lấy nguyên từ `schema.prisma`, không lấy từ SDS. SDS đôi chỗ viết
   tắt (`price`, `name`) trong khi schema là `sellingPrice`, `title` — sơ đồ dùng tên của schema.
4. **Composition vs Association**: chỉ dùng composition cho các model con không có ý nghĩa độc
   lập (token, session, ảnh, stock, ticket instance, message...). Cascade delete đơn thuần
   không đủ để kết luận composition.
5. **Multiplicity theo phạm vi chức năng**: `User "1" *-- "0..1" EmailVerificationToken` dù
   schema khai `EmailVerificationToken[]`, vì code luôn `deleteMany` trước khi `create` nên chỉ
   tồn tại một token sống. Tương tự cho `PasswordResetToken`.
6. **Soft foreign key**: một số FK khai bằng `String` mà không có `@relation` trong Prisma.
   Sơ đồ vẫn vẽ association vì nghiệp vụ có liên kết thật; đây là quan hệ **suy ra**.
   - Luôn vẽ: `Booking.snapshotAttractionId`, `SupportTicket.bookingId`.
   - Chỉ vẽ khi cần nối liền đồ thị (`bridgeOnly` trong `curated.json`): các FK trỏ tới `User`
     như `Attraction.reviewedById`, `RefundRequest.requestedById`, `SupportMessage.senderId`.
     Vẽ mặc định sẽ thành nhiễu ở những chức năng không liên quan tới hành vi đó.
6b. **Khóa chính ghép (`@@id`) luôn hiện đủ mọi thành phần.** `AttractionCategory` phải có cả
   `attractionId` lẫn `categoryId`; bảng nối mà giấu một nửa khóa thì mất ý nghĩa định danh.
7. **Model đọc qua `include` viết tắt**: SDS hay viết `include: attractionInclude` nên không lộ
   tên model. Những model được SDS liệt kê ở dòng *Prisma Models* và có quan hệ trực tiếp với
   một model đã chọn thì vẫn được đưa vào sơ đồ, dù tên không xuất hiện trong câu query.
8. **Giới hạn 7 model/sơ đồ** để giữ sơ đồ đọc được (tối đa thực tế là 8 khi cần thêm một model
   trung gian để nối liền đồ thị). Chức năng liệt kê nhiều hơn (ví dụ *5.4 List Customer Bookings*
   có 10 model) sẽ ưu tiên model được thao tác trực tiếp.
8b. **`AuthSession`, `PartnerProfile`, `UserRoleMembership` không bao giờ được kéo vào sơ đồ chỉ
   vì có quan hệ với model khác.** Chúng chỉ xuất hiện khi chức năng thực sự đọc/ghi chúng, vì
   phần lớn trường hợp chúng do middleware `protect`/`requirePartner` nạp.
9. **Ghi giá trị `null` không phải là hành động thuận.** `rejectionReason: null` là *xóa* lý do từ
   chối chứ không phải *từ chối*, nên method tương ứng là `clearRejection()`. Bảng ánh xạ nằm ở
   `updateNull` trong [_tools/curated.json](_tools/curated.json).
10. **Trường Boolean không sinh setter.** Ghi `isActive: false` cho ra `deactivate()`, ghi
    `isPrimary: true` cho ra `markAsPrimary()` — tên nói rõ ý định thay vì `setActive(...)`.
    Bảng ánh xạ theo giá trị nằm ở `updateBool`.
11. **Thuộc tính phải phủ tham số của method được hiển thị.** Nếu sơ đồ vẽ
    `create(ticketProductId, startTime, endTime)` thì `endTime` bắt buộc xuất hiện ở phần thuộc
    tính, tránh trường hợp method tham chiếu tới thứ không có trên sơ đồ.
12b. **Mỗi lần `update` được xét riêng.** Một chức năng có nhiều nhánh (VNPay IPN: thành công →
    đổi `status`; trùng giao dịch → bật `refundRequired`) thì mỗi nhánh sinh method của nó.
    `changeStatus` chỉ bị bỏ khi **trong cùng lần update đó** đã có method chuyển trạng thái vòng
    đời (`submitForReview`, `archive`, `reject`, `checkIn`…). Method bật/tắt cờ phụ như
    `clearRefundFlag` không được phép nuốt `changeStatus`.
12c. **Toán tử Prisma là hành động, không phải giá trị.** `usedCount: { increment: 1 }` →
    `consumeOne()`, `{ decrement: 1 }` → `releaseOne()`; `heldQty` tăng → `hold()`, giảm →
    `release()`. Bảng ở `updateOp` trong `curated.json`.
12. **Ảnh chèn vào SDS giữ tối thiểu 150 DPI.** Sơ đồ nhỏ được đặt đúng bề rộng tương ứng thay vì
    kéo giãn cho đủ 6.5 inch — kéo giãn làm ảnh rỗ khi in.
