# VietTicket Travel — Backend API

Express 5 + Prisma 7 + PostgreSQL. Cung cấp API cho Auth, User, Admin và **Partner Portal (Module 2)**.

## 1. Yêu cầu

- Node.js 18+
- PostgreSQL 14+ (cài tại máy hoặc dùng dịch vụ cloud như Neon/Supabase)

## 2. Cài đặt

```bash
cd vietticket-travel/backend
npm install
```

## 3. Cấu hình môi trường

Sao chép `.env.example` thành `.env` rồi sửa giá trị:

```bash
cp .env.example .env
```

Bắt buộc điền đúng `DATABASE_URL` trỏ tới PostgreSQL của bạn, ví dụ:

```
DATABASE_URL="postgresql://postgres:matkhau@localhost:5432/vietticket?schema=public"
JWT_SECRET="mot-chuoi-bi-mat-that-dai"
```

> Nếu chưa có database tên `vietticket`, tạo trước bằng: `createdb vietticket`
> hoặc trong psql: `CREATE DATABASE vietticket;`

## 4. Tạo bảng trong database

Chọn **một** trong hai cách:

**Cách A — Migration (khuyến nghị, giữ lịch sử):**
```bash
npx prisma migrate dev --name add_module2_partner
```

**Cách B — Đồng bộ nhanh (không tạo file migration):**
```bash
npm run db:push
```

Cả hai đều tự chạy `prisma generate` để sinh Prisma Client.

## 5. Tạo dữ liệu mẫu (tùy chọn nhưng nên làm)

```bash
npm run db:seed       # tạo danh mục + đối tác mẫu + điểm tham quan mẫu
npm run create-admin  # tạo tài khoản admin@vietticket.com / Admin@123456
```

Tài khoản đối tác mẫu sau khi seed:
- Email: `partner@vietticket.com`
- Mật khẩu: `Partner@123`

## 6. Chạy server

```bash
npm run dev     # nodemon, tự reload
# hoặc
npm start
```

API chạy tại `http://localhost:5000`. Kiểm tra: `GET http://localhost:5000/api/health`.

Frontend (`vietticket-travel`) đã trỏ sẵn tới `http://localhost:5000/api`.

---

## Các endpoint của Module 2 (Partner)

Tất cả nằm dưới `/api/partners` và yêu cầu đăng nhập (cookie JWT).
Trừ `/register`, các route còn lại yêu cầu đã có hồ sơ đối tác.

| Method | Path | Mô tả |
|--------|------|-------|
| POST   | `/api/partners/register` | Nộp hồ sơ KYC → tạo PartnerProfile, nâng role PARTNER |
| GET    | `/api/partners/me` | Lấy hồ sơ đối tác |
| PUT    | `/api/partners/settings` | Cập nhật thông tin đối tác |
| GET    | `/api/partners/dashboard` | Thống kê tổng quan |
| GET    | `/api/partners/categories` | Danh sách danh mục |
| GET    | `/api/partners/attractions` | Danh sách điểm tham quan (phân trang, lọc) |
| POST   | `/api/partners/attractions` | Tạo điểm tham quan |
| GET    | `/api/partners/attractions/:id` | Chi tiết điểm tham quan |
| PUT    | `/api/partners/attractions/:id` | Cập nhật |
| DELETE | `/api/partners/attractions/:id` | Xóa (cascade vé/ảnh/khung giờ) |
| POST   | `/api/partners/attractions/:id/images` | Upload ảnh (multipart, field `images`) |
| GET    | `/api/partners/attractions/:id/tickets` | Danh sách vé |
| POST   | `/api/partners/attractions/:id/tickets` | Tạo vé |
| GET    | `/api/partners/tickets/:ticketId` | Chi tiết vé |
| PUT    | `/api/partners/tickets/:ticketId` | Cập nhật vé |
| DELETE | `/api/partners/tickets/:ticketId` | Xóa vé |
| GET    | `/api/partners/attractions/:id/schedule` | Lấy cấu hình lịch |
| PUT    | `/api/partners/attractions/:id/schedule` | Lưu cấu hình lịch |

### Ghi chú phạm vi
- Module 2 = **CRUD đối tác** (điểm tham quan, vé, lịch, hồ sơ KYC).
- Các số liệu **đặt vé / doanh thu** ở Dashboard & Reports phụ thuộc model `Booking`
  thuộc **module đặt vé** (chưa xây) nên hiện trả về 0; frontend hiển thị dữ liệu mẫu cho phần đó.
- Frontend có **demo fallback**: khi backend chưa chạy, các trang Partner vẫn hoạt động với dữ liệu mẫu.
