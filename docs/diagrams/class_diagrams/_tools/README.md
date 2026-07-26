# Pipeline sinh Model Class Diagram

Toàn bộ 108 sơ đồ trong `docs/diagrams/class_diagrams/` được **sinh tự động**.
Đừng sửa tay file `.puml` — chạy lại `gen.py` sẽ ghi đè. Muốn đổi nội dung thì sửa
`curated.json` rồi sinh lại.

## Nguồn dữ liệu

| Nguồn | Vai trò |
|---|---|
| `Group5_VietTicketTravel_SDS_final.docx` (mục II. Code Designs) | phạm vi chức năng: model nào tham gia, thao tác DB nào |
| `vietticket-travel/backend/prisma/schema.prisma` | tên model/thuộc tính, kiểu, nullable, default, unique, FK, quan hệ |
| `curated.json` | tên domain method, thuộc tính bắt buộc hiển thị, multiplicity theo nghiệp vụ, quan hệ soft-FK |

## Chạy lại

```bash
cd docs/diagrams/class_diagrams/_tools
python docx2txt.py "C:/Users/Lenovo/Desktop/Group5_VietTicketTravel_SDS_final.docx" > sds.md
python parse_sds.py
python parse_schema.py
python gen.py
python mkindex.py
```

Sau đó render PNG (chạy từ gốc repo):

```bash
java "-Dfile.encoding=UTF-8" -jar "docs/diagrams/plantuml.jar" -charset UTF-8 -tpng docs/diagrams/class_diagrams/01_auth_user_account docs/diagrams/class_diagrams/02_attraction_discovery_reviews docs/diagrams/class_diagrams/03_partner_attraction_management docs/diagrams/class_diagrams/04_ticket_product_reservation docs/diagrams/class_diagrams/05_booking_payment_refund docs/diagrams/class_diagrams/06_staff_operations docs/diagrams/class_diagrams/07_support_messaging docs/diagrams/class_diagrams/08_admin_moderation docs/diagrams/class_diagrams/09_ai_weather_newsletter
```

Toàn bộ 108 sơ đồ render trong khoảng 12 giây.

## Sửa nội dung sơ đồ — `curated.json`

- `attributes.<Model>.always` — thuộc tính luôn hiển thị dù SDS không nhắc; `.max` giới hạn số dòng.
- `methods.<Model>.create` — static factory, chỉ hiện khi chức năng có `create`.
- `methods.<Model>.update` — **map field → method**. Method chỉ xuất hiện nếu chức năng thực sự
  ghi đúng field đó trong `data: {...}`. Đặt method đặc thù trước `changeStatus` để nó được ưu tiên.
- `methods.<Model>.check` / `.delete` / `.fallback` — method kiểm tra / kết thúc vòng đời / dự phòng.
- `relCards."<Parent>|<Child>"` — ép multiplicity theo nghiệp vụ khi khác với schema.
- `extraRelations` — quan hệ suy ra từ soft FK (field `*Id` không khai `@relation`).
- `fnModels."<số mục>"` / `fnMethods."<số mục>"` — ghi đè riêng cho một chức năng.

`gen.py` tự kiểm tra tên field trong `curated.json` phải tồn tại trong schema — nếu đặt sai tên,
method sẽ im lặng không xuất hiện, nên chạy đoạn validate trong lịch sử commit khi thêm key mới.

## Quy tắc `gen.py` áp dụng

1. Model được chọn = dòng *Prisma Models* của SDS ∩ có mặt trong bảng *Database Queries*.
2. Nếu đồ thị bị rời rạc, thêm lại model trung gian từ danh sách bị loại cho đến khi liền mạch.
3. Thuộc tính = field được chức năng đọc/ghi/kiểm tra + khóa + FK trỏ tới model cùng sơ đồ;
   sắp xếp ID → FK → nghiệp vụ → trạng thái → thời gian → audit, trong nhóm giữ thứ tự schema.
4. Method suy từ thao tác DB: `create` → static factory, `update` → method khớp field bị ghi,
   `delete` → method kết thúc vòng đời, `find*` → method kiểm tra.
5. Quan hệ đọc từ `@relation`: phía giữ FK là con; composition chỉ cho model con trong
   `COMPOSITION_CHILDREN` của `gen.py`, còn lại là association.
