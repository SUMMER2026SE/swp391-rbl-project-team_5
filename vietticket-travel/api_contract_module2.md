# API Contract - Module 2: Quản lý Địa điểm & Sản phẩm Vé
> **Tài liệu dùng chung cho nhóm Phát triển (Hoàng Anh, Lộc, Phú, Như)**
> * Phú (Backend): Triển khai đúng các Router và kiểu trả về (JSON).
> * Hoàng Anh, Lộc, Như (Frontend): Sử dụng cấu trúc JSON mẫu dưới đây để giả lập dữ liệu (Mock Data) và phát triển giao diện song song.

---

## 📌 Thiết lập Chung (General Setup)
* **Base URL:** `/api/v1`
* **Định dạng dữ liệu:** `application/json`

> ⚠️ **Lưu ý đồng bộ với mã nguồn hiện tại (cập nhật theo code thực tế):**
> * **Base URL thực tế** đang dùng là `/api` (chưa gắn version `v1`). Ví dụ: `POST /api/partners/register`, `GET /api/attractions`.
> * Các endpoint **công khai (Guest/Customer)** và **Admin** trả về đúng envelope `{ success, data }` như mô tả.
> * Các endpoint thuộc **Partner Portal** (`/api/partners/...`) phần lớn trả về **object phẳng** (vd `{ attraction }`, `{ tickets }`, `{ message }`) chứ chưa bọc envelope `{ success, data }`. Phần “Bổ sung” phía dưới ghi đúng cấu trúc thực tế từ controller.
> * Xác thực dùng **JWT qua cookie HttpOnly** (`cookie-parser`), header `Authorization: Bearer <Token>` vẫn được hỗ trợ.

* **Response Envelope chuẩn:**
  * **Thành công (Success):**
    ```json
    {
      "success": true,
      "data": { ... } // Đối tượng hoặc Mảng kết quả
    }
    ```
  * **Thất bại (Error):**
    ```json
    {
      "success": false,
      "error": {
        "code": "ERROR_CODE",
        "message": "Thông điệp chi tiết lỗi hiển thị lên UI"
      }
    }
    ```

---

## 1. Luồng Đối tác & Đăng ký KYC (Partner Flow)

### 1.1 Đăng ký tài khoản Đối tác & Gửi thông tin KYC
* **Endpoint:** `POST /partners/register`
* **Quyền:** Đã đăng nhập (`UserRole` bất kỳ, sau khi duyệt sẽ nâng lên `PARTNER`)
* **Headers:** `Authorization: Bearer <Token>`
* **Request Body:**
  ```json
  {
    "businessName": "Công ty TNHH Du Lịch Việt Nam",
    "businessLicenseUrl": "https://storage.vietticket.com/licenses/abc123xyz.jpg",
    "taxCode": "0102030405",
    "bankName": "Vietcombank",
    "bankAccountNumber": "1023456789",
    "bankAccountName": "NGUYEN VAN A"
  }
  ```
* **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "p-1001",
      "userId": "u-999",
      "businessName": "Công ty TNHH Du Lịch Việt Nam",
      "status": "PENDING",
      "createdAt": "2026-06-02T15:00:00.000Z"
    }
  }
  ```

### 1.2 Xem thông tin hồ sơ Đối tác của tôi
* **Endpoint:** `GET /partners/profile`
* **Quyền:** Đã đăng nhập (`PARTNER` hoặc đang chờ duyệt)
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "p-1001",
      "businessName": "Công ty TNHH Du Lịch Việt Nam",
      "status": "APPROVED",
      "commissionRate": 0.10,
      "bankName": "Vietcombank",
      "bankAccountNumber": "1023456789",
      "bankAccountName": "NGUYEN VAN A",
      "rejectionReason": null
    }
  }
  ```

---

## 2. Quản lý Địa điểm du lịch (Attraction Management)

### 2.1 Đối tác tạo mới Địa điểm (Partner)
* **Endpoint:** `POST /attractions`
* **Quyền:** `PARTNER` (Đã được duyệt)
* **Request Body:**
  ```json
  {
    "title": "Khu Du Lịch Suối Tiên",
    "description": "Khu vui chơi giải trí hàng đầu với nhiều trò chơi hấp dẫn...",
    "address": "120 Xa lộ Hà Nội, Thủ Đức, TP. Hồ Chí Minh",
    "city": "Ho Chi Minh",
    "latitude": 10.8623,
    "longitude": 106.8028,
    "categoryIds": ["cat-01", "cat-03"],
    "images": [
      { "imageUrl": "https://storage.vietticket.com/attractions/suoitien-1.jpg", "isPrimary": true },
      { "imageUrl": "https://storage.vietticket.com/attractions/suoitien-2.jpg", "isPrimary": false }
    ]
  }
  ```
* **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "attr-5001",
      "title": "Khu Du Lịch Suối Tiên",
      "status": "DRAFT",
      "createdAt": "2026-06-02T15:10:00.000Z"
    }
  }
  ```

### 2.2 Đối tác gửi duyệt Địa điểm lên sàn
* **Endpoint:** `PUT /attractions/:id/submit`
* **Quyền:** `PARTNER` (Chủ sở hữu địa điểm)
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "attr-5001",
      "status": "PENDING"
    }
  }
  ```

### 2.3 Khách tìm kiếm & lọc Địa điểm (Guest/Customer)
* **Endpoint:** `GET /attractions`
* **Quyền:** Tự do (Guest)
* **Query Parameters:**
  * `search`: Từ khóa tìm kiếm (Ví dụ: `Suoi Tien`)
  * `city`: Tỉnh/thành phố (Ví dụ: `Ho Chi Minh`)
  * `category`: ID danh mục (Ví dụ: `cat-01`)
  * `limit`: Phân trang - số lượng bản ghi (Mặc định: `10`)
  * `page`: Phân trang - số trang (Mặc định: `1`)
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "attractions": [
        {
          "id": "attr-5001",
          "title": "Khu Du Lịch Suối Tiên",
          "address": "120 Xa lộ Hà Nội, Thủ Đức, TP. Hồ Chí Minh",
          "city": "Ho Chi Minh",
          "primaryImage": "https://storage.vietticket.com/attractions/suoitien-1.jpg",
          "averageRating": 4.5,
          "totalReviews": 128,
          "minPrice": 120000
        }
      ],
      "pagination": {
        "totalItems": 1,
        "totalPages": 1,
        "currentPage": 1,
        "limit": 10
      }
    }
  }
  ```

### 2.4 Xem chi tiết Địa điểm (Guest/Customer)
* **Endpoint:** `GET /attractions/:id`
* **Quyền:** Tự do (Guest)
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "attr-5001",
      "title": "Khu Du Lịch Suối Tiên",
      "description": "Khu vui chơi giải trí hàng đầu với nhiều trò chơi hấp dẫn...",
      "address": "120 Xa lộ Hà Nội, Thủ Đức, TP. Hồ Chí Minh",
      "city": "Ho Chi Minh",
      "latitude": 10.8623,
      "longitude": 106.8028,
      "averageRating": 4.5,
      "totalReviews": 128,
      "images": [
        { "id": "img-01", "imageUrl": "https://storage.vietticket.com/attractions/suoitien-1.jpg", "isPrimary": true },
        { "id": "img-02", "imageUrl": "https://storage.vietticket.com/attractions/suoitien-2.jpg", "isPrimary": false }
      ],
      "categories": [
        { "id": "cat-01", "name": "Công viên giải trí" }
      ],
      "ticketProducts": [
        {
          "id": "tkt-2001",
          "name": "Vé Cổng Suối Tiên (Người Lớn)",
          "description": "Vé vào cổng tham quan và chơi các trò chơi tiêu chuẩn",
          "originalPrice": 150000,
          "sellingPrice": 120000,
          "refundPolicy": "FREE_CANCELLATION"
        }
      ]
    }
  }
  ```

---

## 3. Sản phẩm Vé & Khung giờ (Tickets & Time Slots)

### 3.1 Đối tác tạo sản phẩm Vé mới
* **Endpoint:** `POST /attractions/:attractionId/tickets`
* **Quyền:** `PARTNER` (Chủ địa điểm)
* **Request Body:**
  ```json
  {
    "name": "Vé Trọn Gói Suối Tiên (Trẻ Em)",
    "description": "Dành cho trẻ em dưới 1.4m. Vé bao gồm 18 trò chơi liên hoàn.",
    "originalPrice": 100000,
    "sellingPrice": 80000,
    "refundPolicy": "NON_REFUNDABLE"
  }
  ```
* **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": {
      "id": "tkt-2002",
      "name": "Vé Trọn Gói Suối Tiên (Trẻ Em)",
      "status": "ACTIVE"
    }
  }
  ```

### 3.2 Thiết lập khung giờ bán vé (Time Slot) cho vé
* **Endpoint:** `POST /tickets/:ticketProductId/slots`
* **Quyền:** `PARTNER` (Chủ sở hữu vé)
* **Request Body:**
  ```json
  {
    "slots": [
      { "startTime": "08:00", "endTime": "11:00", "maxCapacity": 100 },
      { "startTime": "13:00", "endTime": "16:00", "maxCapacity": 100 }
    ]
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Thiết lập khung giờ thành công!"
  }
  ```

### 3.3 Khách kiểm tra các khung giờ trống của Vé theo ngày cụ thể (Customer)
* **Endpoint:** `GET /tickets/:ticketProductId/availability`
* **Quyền:** Tự do (Guest)
* **Query Parameters:**
  * `date`: Ngày cần đi (Định dạng: `YYYY-MM-DD`, ví dụ: `2026-06-15`)
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "timeSlotId": "slot-001",
        "startTime": "08:00",
        "endTime": "11:00",
        "maxCapacity": 100,
        "availableTickets": 45 // Sức chứa còn lại (maxCapacity - booked - held)
      },
      {
        "timeSlotId": "slot-002",
        "startTime": "13:00",
        "endTime": "16:00",
        "maxCapacity": 100,
        "availableTickets": 0 // Hết vé
      }
    ]
  }
  ```

### 3.4 Khóa giữ vé tạm thời (Reserve Stock) trong lúc thanh toán (Customer)
* **Endpoint:** `POST /tickets/:ticketProductId/reserve`
* **Quyền:** Đã đăng nhập (`CUSTOMER`)
* **Request Body:**
  ```json
  {
    "date": "2026-06-15",
    "timeSlotId": "slot-001", // Tùy chọn nếu vé yêu cầu thời gian
    "quantity": 3
  }
  ```
* **Response (200 OK - Lock vé thành công trong 10 phút):**
  ```json
  {
    "success": true,
    "data": {
      "reservationId": "res-9988-aabb",
      "ticketProductId": "tkt-2001",
      "quantity": 3,
      "expiresAt": "2026-06-02T15:35:00.000Z" // Thời hạn hết giữ vé
    }
  }
  ```

---

## 4. Quản trị của Admin (Admin Moderation)

### 4.1 Danh sách hồ sơ Đối tác đang chờ duyệt
* **Endpoint:** `GET /admin/partners`
* **Quyền:** `ADMIN`
* **Query Parameters:** `status=PENDING`
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "p-1001",
        "businessName": "Công ty TNHH Du Lịch Việt Nam",
        "taxCode": "0102030405",
        "createdAt": "2026-06-02T15:00:00.000Z"
      }
    ]
  }
  ```

### 4.2 Admin duyệt hoặc từ chối hồ sơ đối tác
* **Endpoint:** `PUT /admin/partners/:id/review`
* **Quyền:** `ADMIN`
* **Request Body:**
  ```json
  {
    "action": "APPROVED", // Hoặc "REJECTED"
    "rejectionReason": null // Hoặc Lý do từ chối nếu action là REJECTED
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Trạng thái đối tác đã được cập nhật thành APPROVED"
  }
  ```

### 4.3 Admin Duyệt/Từ chối duyệt địa điểm du lịch
* **Endpoint:** `PUT /admin/attractions/:id/review`
* **Quyền:** `ADMIN`
* **Request Body:**
  ```json
  {
    "action": "APPROVED", // Hoặc "REJECTED"
    "rejectionReason": "Hình ảnh mờ và thiếu thông tin chi tiết"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Trạng thái địa điểm được cập nhật thành REJECTED"
  }
  ```

### 4.4 Admin ẩn địa điểm do vi phạm (Tự động kích hoạt mail thông báo)
* **Endpoint:** `PUT /admin/attractions/:id/hide`
* **Quyền:** `ADMIN`
* **Request Body:**
  ```json
  {
    "reason": "Kinh doanh vé lậu trái phép và nhận phản ánh xấu từ khách hàng"
  }
  ```
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Địa điểm đã bị ẩn thành công và email cảnh báo đã gửi tới đối tác."
  }
  ```

---

# 🧩 PHẦN BỔ SUNG — Các endpoint Module 2 đã triển khai trong dự án

> Phần này tài liệu hóa các API đã có trong mã nguồn nhưng chưa được liệt kê ở 4 mục đầu. Cấu trúc request/response phản ánh **đúng controller hiện tại**.

## 5. Hồ sơ & Tổng quan Đối tác (Partner Portal)

> Tất cả route dưới đây yêu cầu đăng nhập và đã có hồ sơ đối tác. Các thao tác nghiệp vụ (tạo/sửa địa điểm, vé, lịch…) còn yêu cầu đối tác **đã được duyệt** (`requireApprovedPartner`).

### 5.1 Xem hồ sơ đối tác của tôi
* **Endpoint:** `GET /partners/me`  *(thay cho `GET /partners/profile` ở mục 1.2 — code dùng `/me`)*
* **Quyền:** Đã có hồ sơ đối tác (truy cập được cả khi `PENDING`/`REJECTED` để hiển thị trạng thái)
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "id": "p-1001",
      "businessName": "Công ty TNHH Du Lịch Việt Nam",
      "businessLicenseUrl": "https://.../licenses/abc.jpg",
      "taxCode": "0102030405",
      "bankName": "Vietcombank",
      "branchName": "CN TP.HCM",
      "bankAccountNumber": "1023456789",
      "bankAccountName": "NGUYEN VAN A",
      "swiftCode": "",
      "payoutCurrency": "VND",
      "website": "",
      "description": "",
      "status": "APPROVED",
      "rejectionReason": "",
      "displayName": "Nguyễn Văn A",
      "contactEmail": "a@example.com",
      "phone": "0901234567",
      "createdAt": "2026-06-02T15:00:00.000Z"
    }
  }
  ```

### 5.2 Cập nhật thông tin đối tác (tab Cài đặt)
* **Endpoint:** `PUT /partners/settings`
* **Quyền:** `PARTNER` (đã duyệt)
* **Request Body (mọi field tùy chọn):**
  ```json
  {
    "businessName": "Tên hiển thị mới",
    "website": "https://example.com",
    "description": "Mô tả ngắn về đối tác",
    "bankName": "Vietcombank",
    "branchName": "CN TP.HCM",
    "bankAccountNumber": "1023456789",
    "bankAccountName": "NGUYEN VAN A",
    "displayName": "Nguyễn Văn A",
    "phone": "0901234567"
  }
  ```
* **Response (200 OK):** `{ "message": "...", "partner": { ...hồ sơ như 5.1 } }`

### 5.3 Thống kê tổng quan (Dashboard)
* **Endpoint:** `GET /partners/dashboard`
* **Quyền:** `PARTNER` (đã duyệt)
* **Response (200 OK):**
  ```json
  {
    "stats": {
      "totalAttractions": 5,
      "activeAttractions": 3,
      "totalTickets": 12,
      "totalBookingsThisMonth": 40,
      "revenueThisMonth": 12000000,
      "ticketsSoldThisMonth": 80,
      "totalRevenue": 50000000,
      "totalTicketsSold": 320,
      "netRevenueThisMonth": 10800000,
      "netTotalRevenue": 45000000,
      "occupancyRate": 0.62,
      "pendingBookings": 4
    },
    "recentBookings": [ /* 5 đơn mới nhất */ ],
    "partnerStatus": "APPROVED"
  }
  ```

### 5.4 Báo cáo doanh thu theo kỳ
* **Endpoint:** `GET /partners/reports?period=week|month|quarter|year`
* **Quyền:** `PARTNER` (đã duyệt)
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "period": "month",
      "summary": {
        "bookings": 40,
        "ticketsSold": 80,
        "grossRevenue": 12000000,
        "commission": 1200000,
        "netRevenue": 10800000
      },
      "timeline": [ { "label": "2026-06-01", "value": 500000 } ],
      "attractions": [
        { "id": "attr-5001", "name": "Suối Tiên", "bookings": 20, "ticketsSold": 40, "revenue": 6000000, "share": 0.5 }
      ]
    }
  }
  ```

### 5.5 Danh sách danh mục (cho form tạo địa điểm)
* **Endpoint:** `GET /partners/categories`
* **Quyền:** `PARTNER` (đã duyệt)
* **Response (200 OK):** `{ "categories": [ { "id": "cat-01", "name": "Công viên giải trí" } ] }`

---

## 6. Quản lý Địa điểm — Partner Portal (CRUD đầy đủ)

> Khác với mục 2 (gửi duyệt công khai), đây là bộ API quản trị địa điểm trong trang đối tác. Địa điểm đã từng được duyệt sẽ được sửa qua cơ chế **bản nháp (`draftData`)**: mọi thay đổi đưa địa điểm về `status = DRAFT` cho tới khi gửi duyệt lại.

### 6.1 Danh sách địa điểm của đối tác
* **Endpoint:** `GET /partners/attractions`
* **Quyền:** `PARTNER` (đã duyệt)
* **Query:** `search`, `status` (`DRAFT|PENDING|APPROVED|REJECTED|SUSPENDED|ACTIVE|INACTIVE`), `city`, `page`, `limit` (tối đa 50)
* **Response (200 OK):**
  ```json
  {
    "attractions": [ { "id": "attr-5001", "title": "...", "status": "APPROVED", "publicationStatus": "ACTIVE" } ],
    "pagination": { "total": 1, "page": 1, "limit": 10, "totalPages": 1 }
  }
  ```

### 6.2 Chi tiết địa điểm (của đối tác)
* **Endpoint:** `GET /partners/attractions/:id`
* **Quyền:** `PARTNER` (chủ sở hữu)
* **Response (200 OK):** `{ "attraction": { ...chi tiết đầy đủ kèm images, categories, ticketProducts, timeSlots, specialDates } }`
* **Lỗi:** `404 { "message": "Không tìm thấy điểm tham quan." }`

### 6.3 Tạo địa điểm (Partner Portal)
* **Endpoint:** `POST /partners/attractions`
* **Quyền:** `PARTNER` (đã duyệt)
* **Request Body:** (chấp nhận cả tên `name/province/lat/lng` lẫn `title/city/latitude/longitude`)
  ```json
  {
    "name": "Khu Du Lịch Suối Tiên",
    "description": "...",
    "address": "120 Xa lộ Hà Nội",
    "province": "Ho Chi Minh",
    "district": "Thủ Đức",
    "lat": 10.8623,
    "lng": 106.8028,
    "openTime": "08:00",
    "closeTime": "18:00",
    "category": "Công viên giải trí",
    "images": [ { "imageUrl": "https://.../1.jpg", "isPrimary": true } ]
  }
  ```
* **Response (201 Created):**
  ```json
  {
    "success": true,
    "data": { "id": "attr-5001", "title": "Khu Du Lịch Suối Tiên", "status": "DRAFT", "createdAt": "..." },
    "message": "Tạo điểm tham quan thành công.",
    "attraction": { /* chi tiết đầy đủ */ }
  }
  ```

### 6.4 Cập nhật địa điểm
* **Endpoint:** `PUT /partners/attractions/:id`
* **Quyền:** `PARTNER` (chủ sở hữu, địa điểm không bị `SUSPENDED`)
* **Request Body:** Các field như 6.3 (partial). Nếu địa điểm đã được duyệt → ghi vào `draftData`, đưa `status` về `DRAFT`.
* **Response (200 OK):** `{ "message": "Cập nhật điểm tham quan thành công.", "attraction": { ... } }`

### 6.5 Lưu trữ (xóa mềm) địa điểm
* **Endpoint:** `DELETE /partners/attractions/:id`
* **Quyền:** `PARTNER` (chủ sở hữu)
* **Response (200 OK):** `{ "message": "Đã lưu trữ điểm tham quan. Lịch sử đặt vé và thanh toán được giữ nguyên." }`
* **Lỗi (409):** Còn đơn đặt vé chưa sử dụng trong tương lai → không cho lưu trữ.

### 6.6 Bật/tắt bán vé (Publication)
* **Endpoint:** `PATCH /partners/attractions/:id/publication`
* **Quyền:** `PARTNER` (chủ sở hữu, địa điểm đã từng được duyệt)
* **Request Body:** `{ "publicationStatus": "ACTIVE" }` *(hoặc `"PAUSED"`)*
* **Response (200 OK):** `{ "success": true, "message": "Đã kích hoạt..." }`
* **Lỗi:** `400 INVALID_STATE` (chưa từng duyệt), `403 FORBIDDEN` (đang bị đình chỉ)

### 6.7 Tải ảnh địa điểm (multipart)
* **Endpoint:** `POST /partners/attractions/:id/images`
* **Quyền:** `PARTNER` (chủ sở hữu)
* **Content-Type:** `multipart/form-data`, field `images` (tối đa 10 file)
* **Response (201 Created):**
  ```json
  {
    "message": "Tải ảnh thành công.",
    "images": [ { "id": "img-10", "url": "https://.../uploads/abc.jpg", "isPrimary": true } ]
  }
  ```

### 6.8 Xóa ảnh
* **Endpoint:** `DELETE /partners/attractions/:id/images/:imageId`
* **Response (200 OK):** `{ "message": "Đã xóa ảnh." }` *(nếu xóa ảnh đại diện, hệ thống tự gán ảnh khác làm primary)*

### 6.9 Đặt ảnh đại diện
* **Endpoint:** `PATCH /partners/attractions/:id/images/:imageId/primary`
* **Response (200 OK):** `{ "message": "Đã cập nhật ảnh đại diện." }`

---

## 7. Quản lý Gói vé — Partner Portal

> Bộ API quản lý vé trong trang đối tác (khác mục 3.1 vốn lồng dưới `/attractions/:id/tickets`). Vé của địa điểm đã duyệt được sửa trong `draftData` (id dạng `draft-...`).

### 7.1 Danh sách vé của một địa điểm
* **Endpoint:** `GET /partners/attractions/:id/tickets`
* **Response (200 OK):** `{ "attraction": { "id": "...", "name": "..." }, "tickets": [ ... ] }`

### 7.2 Tạo gói vé
* **Endpoint:** `POST /partners/attractions/:id/tickets`
* **Request Body:**
  ```json
  {
    "name": "Vé người lớn",
    "type": "ADULT",
    "description": "...",
    "originalPrice": 150000,
    "sellingPrice": 120000,
    "refundPolicy": "FREE_CANCELLATION",
    "refundFeeRate": 0
  }
  ```
* **Response (201 Created):** `{ "message": "Tạo gói vé thành công.", "ticket": { ... } }`

### 7.3 Chi tiết gói vé
* **Endpoint:** `GET /partners/tickets/:ticketId` → `{ "ticket": { ... } }`

### 7.4 Cập nhật gói vé
* **Endpoint:** `PUT /partners/tickets/:ticketId`
* **Request Body:** các field như 7.2 (partial). Ràng buộc: `sellingPrice <= originalPrice`.
* **Response (200 OK):** `{ "message": "Cập nhật gói vé thành công.", "ticket": { ... } }`

### 7.5 Lưu trữ gói vé
* **Endpoint:** `DELETE /partners/tickets/:ticketId`
* **Response (200 OK):** `{ "message": "Đã lưu trữ gói vé. Lịch sử đặt vé được giữ nguyên." }`

> **Lưu ý refundPolicy:** chấp nhận `NON_REFUNDABLE`, `FREE_CANCELLATION`, `REFUND_WITH_FEE`. Khi chọn `REFUND_WITH_FEE` mà không gửi `refundFeeRate` hợp lệ, hệ thống dùng mức phí mặc định.

---

## 8. Lịch hoạt động & Sức chứa (Schedule)

### 8.1 Lấy cấu hình lịch của địa điểm
* **Endpoint:** `GET /partners/attractions/:id/schedule`
* **Quyền:** `PARTNER` (chủ sở hữu)
* **Response (200 OK):**
  ```json
  {
    "schedule": {
      "openDays": [true, true, true, true, true, false, false],
      "defaultCapacity": 200,
      "timeSlots": [ { "id": "slot-1", "start": "08:00", "end": "11:00", "capacity": 100, "isActive": true } ],
      "specialDates": { "2026-09-02": { "closed": true } }
    }
  }
  ```

### 8.2 Lưu (thay thế toàn bộ) cấu hình lịch
* **Endpoint:** `PUT /partners/attractions/:id/schedule`
* **Quyền:** `PARTNER` (chủ sở hữu, địa điểm không bị `SUSPENDED`)
* **Request Body (mọi nhóm tùy chọn):**
  ```json
  {
    "openDays": [true, true, true, true, true, false, false],
    "defaultCapacity": 200,
    "timeSlots": [ { "start": "08:00", "end": "11:00", "capacity": 100 } ],
    "specialDates": { "2026-09-02": { "closed": true, "capacity": 50 } }
  }
  ```
* **Ràng buộc:** giờ hợp lệ `HH:mm`, `start < end`, **không cho khung giờ chồng lấn**, sức chứa ≥ 0.
* **Response (200 OK):** `{ "message": "Lưu cấu hình lịch thành công." }`

---

## 9. Bản đồ & Tìm kiếm mở rộng (Public)

### 9.1 Điểm bản đồ
* **Endpoint:** `GET /attractions/map-points`
* **Quyền:** Tự do (Guest)
* **Response (200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "points": [
        { "id": "attr-5001", "title": "Suối Tiên", "city": "Ho Chi Minh", "latitude": 10.86, "longitude": 106.80, "primaryImage": "https://...", "minPrice": 120000 }
      ],
      "total": 1
    }
  }
  ```

### 9.2 Bộ lọc mở rộng cho `GET /attractions`
Ngoài các tham số ở mục 2.3, endpoint còn hỗ trợ: `minPrice`, `maxPrice`, `minRating`, và `sort` (`popular | rating | price-asc | price-desc`).

---

## 10. Quản trị bổ sung (Admin)

### 10.1 Danh sách địa điểm chờ kiểm duyệt
* **Endpoint:** `GET /admin/attractions`
* **Quyền:** `ADMIN`
* **Query:** `status`, `search`, `page`, `limit`
* **Response (200 OK):** `{ "success": true, "data": [ { ...địa điểm + partner + ticketProducts + schedule + reviewHistory } ], "pagination": { ... } }`
  *(Khi `status = PENDING`, dữ liệu hiển thị lấy từ `submittedData` — phiên bản đang gửi duyệt.)*

### 10.2 Dashboard tổng quan Admin
* **Endpoint:** `GET /admin/dashboard?period=week|month|quarter|year`
* **Quyền:** `ADMIN`
* **Response (200 OK):** `{ "success": true, "data": { "period", "stats": { "revenue", "totalUsers", "totalAttractions", "activeAttractions", "pendingPartners", "newPartners", "bookings" }, "trend": [...], "pendingPartners": [...], "pendingAttractions": [...] } }`

### 10.3 Quản lý Danh mục (Category CRUD)
* **Liệt kê:** `GET /admin/categories` → `{ "success": true, "data": [ { "id", "name", "description", "icon", "isActive", "attractionCount", "createdAt" } ] }`
* **Tạo:** `POST /admin/categories` — body `{ "name", "description?", "icon?", "isActive?" }` → `201 { "success": true, "data": { ...category } }`
* **Cập nhật:** `PUT /admin/categories/:id` — body partial → `200 { "success": true, "data": { ... } }`
* **Xóa:** `DELETE /admin/categories/:id` → `200 { "message": "Đã xóa danh mục." }`
  * **Lỗi (409):** Danh mục đang được dùng → gợi ý chuyển sang ẩn (`isActive=false`) thay vì xóa.
  * **Lỗi (409):** Trùng tên (`P2002`).

> **Ghi chú điều chỉnh so với bản gốc:**
> * Mục 3.1 trong code là `createTicketProduct` yêu cầu `name, description, originalPrice, sellingPrice` (description bắt buộc).
> * Mục 3.2: route thực tế là `POST /tickets/:ticketProductId/slots`; mỗi slot cần `startTime`, `endTime`, `maxCapacity ≥ 1`.
> * Mục 3.3: response `availableTickets` đã trừ cả giới hạn sức chứa cấp **địa điểm/ngày** lẫn cấp **khung giờ**; kèm `meta` (closed, slotSource, dayCapacity).
> * Mục 3.4: `reserve` chỉ cho ngày từ hôm nay (giờ VN) tới tối đa 1 năm; giữ chỗ 10 phút.

---

# 🌐 PHẦN II — TOÀN BỘ API CÁC MODULE KHÁC

> Phần này mở rộng tài liệu ra ngoài Module 2 để cả nhóm có một bản tham chiếu API thống nhất, bám sát mã nguồn backend hiện tại. Các nhóm: **Xác thực, Người dùng, Yêu thích, Đặt vé, Thanh toán & Hoàn tiền, Nhân viên (Staff), Đánh giá, Hỗ trợ, AI, Newsletter, Upload, Quản trị người dùng.**

## 11. Xác thực (Authentication) — `/api/auth`

> Phát hành phiên qua **cookie HttpOnly**. Các route nhạy cảm bị rate-limit (5 request/15 phút/IP).

| # | Method & Endpoint | Quyền | Mô tả |
|---|---|---|---|
| 11.1 | `POST /auth/register` | Public | Đăng ký `{ fullName, email, password, phoneNumber? }` → `201 { message, user }` (gửi email xác minh) |
| 11.2 | `POST /auth/verify-email` | Public | `{ token }` → `{ message, user }` |
| 11.3 | `POST /auth/resend-verification` | Public | `{ email }` → `{ message }` |
| 11.4 | `POST /auth/login` | Public | `{ email, password }` → set-cookie + `{ message, user }`; lỗi `403 EMAIL_NOT_VERIFIED` nếu chưa xác minh |
| 11.5 | `POST /auth/google` | Public | `{ credential }` (Google ID token) → set-cookie + `{ message, user }` |
| 11.6 | `POST /auth/logout` | Đã đăng nhập | Thu hồi phiên + xóa cookie → `{ message }` |
| 11.7 | `POST /auth/forgot-password` | Public | `{ email }` → `{ message }` (luôn trả thông điệp an toàn) |
| 11.8 | `POST /auth/reset-password` | Public | `{ token, newPassword }` → `{ message }` (thu hồi mọi phiên cũ) |
| 11.9 | `GET /auth/me` | Đã đăng nhập | → `{ user }` |

* **Đối tượng `user` (sanitize):**
  ```json
  {
    "id": "u-1", "email": "a@example.com", "fullName": "Nguyễn Văn A",
    "role": "CUSTOMER", "provider": "LOCAL", "isEmailVerified": true,
    "status": "ACTIVE", "createdAt": "...", "updatedAt": "...",
    "profile": { "phoneNumber": "0901234567", "avatarUrl": null, "gender": null, "address": null, "dateOfBirth": null }
  }
  ```

## 12. Người dùng (User Profile) — `/api/users`

| # | Method & Endpoint | Quyền | Mô tả |
|---|---|---|---|
| 12.1 | `GET /users/profile` | Đã đăng nhập | → `{ user }` |
| 12.2 | `PUT /users/profile` | Đã đăng nhập | `{ fullName?, phoneNumber?, avatarUrl?, gender?, address?, dateOfBirth? }` → `{ message, user }` |
| 12.3 | `POST /users/upload-avatar` | Đã đăng nhập | `multipart/form-data` field `avatar` → `{ avatarUrl, message, user }` |
| 12.4 | `PUT /users/change-password` | Đã đăng nhập (LOCAL) | `{ currentPassword, newPassword }` → `{ message }` |

## 13. Địa điểm yêu thích (Favorites) — `/api/favorites`, `/api/attractions/:id/favorite`

| # | Method & Endpoint | Quyền | Mô tả |
|---|---|---|---|
| 13.1 | `POST /attractions/:id/favorite` | Đã đăng nhập | Bật/tắt yêu thích → `{ success, data: { attractionId, isFavorite }, message }` |
| 13.2 | `GET /favorites` | Đã đăng nhập | → `{ success, data: { favorites: [ { attractionId, createdAt, attraction: { id, title, address, city, primaryImage, averageRating, totalReviews, minPrice } } ] } }` |

## 14. Đặt vé (Booking) — `/api/bookings`

> Quyền: `CUSTOMER`. Luồng: `reserve` (mục 3.4) → `POST /bookings` tạo đơn `PENDING_PAYMENT` → thanh toán VNPay (mục 15).

### 14.1 Áp mã ưu đãi (xem trước)
* **Endpoint:** `POST /bookings/apply-voucher`
* **Body:** `{ "voucherCode": "SUMMER10", "subtotalAmount": 240000 }`
* **Response (200):** `{ success, message, data: { voucher: { id, code, discountType, discountValue, maxDiscount, minSpend, expiryDate }, discountAmount, totalAmount } }`
* **Lỗi (400):** mã sai/hết hạn/hết lượt/chưa đạt mức tối thiểu.

### 14.2 Tạo đơn đặt vé
* **Endpoint:** `POST /bookings`
* **Body:** `{ "reservationId", "fullName", "email", "phone?", "note?", "voucherCode?", "paymentMethod": "vnpay" }`
* **Response (201):** `{ success, message, data: { ...booking } }`
* **Lỗi:** `404` reservation, `409` reservation hết hạn / đã có booking.

### 14.3 Danh sách đơn của tôi
* **Endpoint:** `GET /bookings` → `{ success, data: [ ...booking ] }`

### 14.4 Chi tiết đơn
* **Endpoint:** `GET /bookings/:bookingId` → `{ success, data: { ...booking } }`

### 14.5 Chi tiết đơn giữ chỗ
* **Endpoint:** `GET /bookings/reservations/:reservationId` → `{ success, data: { ...reservation } }`

* **Đối tượng `booking` (rút gọn):**
  ```json
  {
    "id": "bk-1", "reservationId": "res-1", "attractionTitle": "...", "attractionImage": "...",
    "ticketName": "...", "visitDate": "2026-06-15", "timeSlotLabel": "08:00 - 11:00",
    "quantity": 2, "unitPrice": 120000, "subtotalAmount": 240000, "discountAmount": 24000,
    "totalAmount": 216000, "voucherCode": "SUMMER10",
    "customer": { "fullName": "...", "email": "...", "phone": "..." },
    "status": "unpaid", "paymentStatus": "pending", "refundPolicy": "FREE_CANCELLATION",
    "refundRequest": null, "ticketInstances": [ { "id": "...", "qrCodeToken": "...", "status": "valid" } ]
  }
  ```

## 15. Thanh toán & Hoàn tiền (VNPay) — `/api/payments`

| # | Method & Endpoint | Quyền | Mô tả |
|---|---|---|---|
| 15.1 | `POST /payments/create-vnpay-url` | `CUSTOMER` | `{ bookingId }` → `{ success, data: { paymentUrl } }`. Giới hạn 3 lần thử/đơn |
| 15.2 | `GET /payments/refund-preview/:bookingId` | `CUSTOMER` | Xem trước số tiền hoàn → `{ success, data: { totalAmount, refundPolicy, refundFeeRate, feeAmount, refundAmount, refundable, notRefundableReason, ... } }` |
| 15.3 | `POST /payments/refund-request` | `CUSTOMER` | `{ bookingId, reason }` (≥5 ký tự) → `201 { success, data: { ...refundRequest } }`; chuyển đơn sang `REFUND_REQUESTED` |
| 15.4 | `GET /payments/vnpay-ipn` | VNPay (no-auth) | Server-to-server. Luôn `200 { RspCode, Message }` |
| 15.5 | `GET /payments/vnpay-return` | VNPay (no-auth) | Redirect về `FRONTEND_URL/booking-success?...` |

> **Cơ chế tiền:** số tiền VNPay nhân 100; chữ ký HMAC bắt buộc; đơn cần duyệt thủ công (`requiresManualApproval`) sẽ vào trạng thái `PENDING_PARTNER`, ngược lại `CONFIRMED` + sinh vé QR. Thanh toán trùng được ghi nhận để hoàn tiền tự động.

## 16. Nhân viên cổng (Staff) — `/api/staff`

> Quyền `STAFF`/`ADMIN`, và staff chỉ thao tác khi đối tác chủ quản còn `APPROVED` (`requireActiveEmployer`). Check-in giới hạn theo địa điểm được phân công.

| # | Method & Endpoint | Quyền | Mô tả |
|---|---|---|---|
| 16.1 | `GET /staff/refunds?status=` | Staff/Admin | Hàng đợi yêu cầu hoàn tiền |
| 16.2 | `PATCH /staff/refunds/:refundId` | Staff/Admin | `{ action: "APPROVED"\|"REJECTED", staffNotes? }`. Khi duyệt + đơn VNPay → gọi cổng hoàn tiền trước |
| 16.3 | `POST /staff/bookings/:bookingId/reissue` | Staff (được phân công)/Admin | Cấp lại vé QR (thu hồi vé cũ) |
| 16.4 | `GET /staff/bookings/today` | Staff/Admin | Đơn cần check-in hôm nay (giờ VN) + `meta { date, total, checkedIn }` |
| 16.5 | `GET /staff/checkin/:token` | Staff/Admin | Tra cứu vé theo QR (chỉ xem) → `{ ...vé, canCheckIn, blockReason }` |
| 16.6 | `POST /staff/checkin/:token` | Staff/Admin | Check-in cả đơn (mọi vé `VALID` → `USED`) → `{ message, data }` |
| 16.7 | `GET /staff/assignments/:staffId` | `ADMIN` | Phân công địa điểm hiện tại của nhân viên |
| 16.8 | `PUT /staff/assignments/:staffId` | `ADMIN` | `{ attractionIds: [...] }` thay toàn bộ phân công |

> Mã QR khách quét có thể là `VIETTICKET:<token>` hoặc token thuần. Lý do chặn check-in (`blockReason`): vé đã dùng/hoàn/thu hồi, đơn chưa xác nhận, hoặc sai ngày tham quan.

## 17. Quản lý Nhân viên phía Đối tác — `/api/partners/staff`

> Quyền `PARTNER` (đã duyệt). Mỗi đối tác tự quản nhân viên của mình; phân công chỉ trong phạm vi địa điểm của đối tác.

| # | Method & Endpoint | Mô tả |
|---|---|---|
| 17.1 | `GET /partners/staff` | Danh sách nhân viên → `{ success, data: [ { id, email, fullName, status, activated, phoneNumber, assignments: [...] } ] }` |
| 17.2 | `POST /partners/staff` | `{ fullName, email, phoneNumber? }` tạo nhân viên + gửi email mời đặt mật khẩu → `201` |
| 17.3 | `POST /partners/staff/:staffId/invite` | Gửi lại email mời (nếu chưa kích hoạt) |
| 17.4 | `PATCH /partners/staff/:staffId/status` | `{ status: "ACTIVE"\|"LOCKED" }` |
| 17.5 | `GET /partners/staff/:staffId/assignments` | Phân công + danh sách địa điểm của đối tác |
| 17.6 | `PUT /partners/staff/:staffId/assignments` | `{ attractionIds: [...] }` thay toàn bộ phân công |
| 17.7 | `DELETE /partners/staff/:staffId` | Gỡ nhân viên (khóa mềm + thu hồi phân công, giữ lịch sử) |

## 18. Đánh giá (Reviews) — `/api/reviews`, `/api/partners/reviews`, `/api/admin/reviews`

| # | Method & Endpoint | Quyền | Mô tả |
|---|---|---|---|
| 18.1 | `GET /reviews?attractionId=&page=&limit=&rating=` | Public | Review công khai + `meta` phân trang + `breakdown` (histogram 1–5 sao) |
| 18.2 | `POST /reviews` | `CUSTOMER` | `{ bookingId, rating(1-5), comment? }`; chỉ với đơn `COMPLETED`, mỗi đơn 1 lần |
| 18.3 | `POST /reviews/:reviewId/reply` | `PARTNER` (đã duyệt, chủ địa điểm) | `{ replyComment }` |
| 18.4 | `PATCH /reviews/:reviewId/moderate` | `ADMIN`/`STAFF` | `{ isHidden: boolean }` (ẩn/hiện + tính lại điểm trung bình) |
| 18.5 | `GET /partners/reviews` | `PARTNER` (đã duyệt) | Tất cả review thuộc các địa điểm của đối tác |
| 18.6 | `GET /partners/reviews/stats` | `PARTNER` (đã duyệt) | `{ averageRating, totalReviews, unrepliedReviews }` |
| 18.7 | `GET /admin/reviews` | `ADMIN` | Toàn bộ review để kiểm duyệt |

## 19. Hỗ trợ khách hàng (Support Tickets) — `/api/support`

> Đã đăng nhập. Có realtime qua WebSocket (`emitSupportMessage`, `emitSupportTicketUpdated`). Trạng thái: `OPEN | IN_PROGRESS | RESOLVED`.

| # | Method & Endpoint | Quyền | Mô tả |
|---|---|---|---|
| 19.1 | `POST /support/tickets` | `CUSTOMER` | `{ subject, description(≥10), bookingId? }` → `201` (mô tả thành tin nhắn đầu) |
| 19.2 | `GET /support/tickets/my-tickets` | `CUSTOMER` | Ticket của tôi (kèm tin nhắn mới nhất) |
| 19.3 | `GET /support/tickets?status=&search=` | Staff/Admin | Toàn bộ ticket |
| 19.4 | `PATCH /support/tickets/:ticketId/status` | Staff/Admin | `{ status }` |
| 19.5 | `GET /support/tickets/:ticketId` | Chủ ticket / Staff/Admin | Chi tiết + toàn bộ tin nhắn |
| 19.6 | `POST /support/tickets/:ticketId/messages` | Chủ ticket / Staff/Admin | `{ message }` (Staff trả lời ticket OPEN → tự chuyển IN_PROGRESS) |

## 20. Trợ lý AI — `/api/ai`

> `/chat` và `/itinerary` gọi LLM nên có rate-limit riêng (20 request/5 phút/IP); `/itinerary` yêu cầu đăng nhập; `/recommend` là rule-based (public).

| # | Method & Endpoint | Quyền | Body & Mô tả |
|---|---|---|---|
| 20.1 | `POST /ai/chat` | Public (limited) | `{ message, history? }` → `{ success, data: { reply, provider } }` |
| 20.2 | `POST /ai/recommend` | Public | `{ budget, people\|adults/children, city?, interests?, priority?, companion? }` → `{ success, data, provider }` |
| 20.3 | `POST /ai/itinerary` | Đã đăng nhập (limited) | `{ city, days(1-14), people\|adults/children, budget?, interests?, pace?, priority?, companion? }` → `{ success, data, provider }` |

## 21. Newsletter & Upload

| # | Method & Endpoint | Quyền | Mô tả |
|---|---|---|---|
| 21.1 | `POST /newsletter/subscribe` | Public | `{ email }` → `{ message }` (upsert đăng ký) |
| 21.2 | `POST /upload/attraction-images` | `PARTNER`/`ADMIN` | `multipart` field `images` (≤10) → `{ success, data: { urls: [...] } }` |
| 21.3 | `POST /upload/document` | Đã đăng nhập | `multipart` field `document` → `{ success, data: { url } }` (tài liệu riêng tư) |
| 21.4 | `GET /upload/documents/:filename` | Chủ tài liệu / Staff/Admin | Tải tài liệu riêng tư (KYC…), kiểm soát quyền truy cập |

## 22. Quản trị Người dùng & Booking (Admin) — `/api/admin`

> Bổ sung cho mục 4 & 10. Quyền `ADMIN`.

| # | Method & Endpoint | Mô tả |
|---|---|---|
| 22.1 | `GET /admin/users?search=&role=&status=&page=&limit=` | Danh sách tài khoản + `stats` (tổng/khách/đối tác/bị khóa) |
| 22.2 | `PATCH /admin/users/:id/status` | `{ status: "ACTIVE"\|"LOCKED", reason?, sendEmail? }` (không tự khóa chính mình) |
| 22.3 | `GET /admin/bookings?status=&search=&refundRequired=&page=&limit=` | Đặt vé toàn sàn + `stats { countsByStatus, refundRequired, grossRevenue }` |

## 23. Quản lý Đặt vé phía Đối tác — `/api/partners/bookings`

> Quyền `PARTNER` (đã duyệt). Dùng cho địa điểm bật chế độ duyệt thủ công (`requiresManualApproval`): đơn đã thanh toán nằm ở `PENDING_PARTNER` chờ đối tác xác nhận.

| # | Method & Endpoint | Mô tả |
|---|---|---|
| 23.1 | `GET /partners/bookings?status=&search=&page=&limit=` | Danh sách đặt vé của đối tác → `{ success, data: [ ...booking ], pagination }`. `status`: `confirmed\|pending_partner\|cancelled\|completed\|all` |
| 23.2 | `PATCH /partners/bookings/:id/approve` | Duyệt đơn → `CONFIRMED` + sinh vé QR + xác nhận kho. `{ success, message, data: { id, status: "confirmed" } }` |
| 23.3 | `PATCH /partners/bookings/:id/reject` | `{ reason }` (≥5 ký tự) → `CANCELLED` + hoàn kho; đơn đã thu tiền tự tạo `RefundRequest` hoàn 100% cho Staff duyệt |

* **Mỗi `booking` (phía đối tác) gồm:** `id, attraction, ticket, customer, email, phone, visitDate, slot, qty, amount, status, refundStatus, paymentGateway, paymentStatus, ticketInstances[...]`.

## 24. Health Check — `/api/health`

* **Endpoint:** `GET /api/health` — Public, không rate-limit.
* **Response (200):** `{ "status": "ok", "database": "connected", "timestamp": "..." }`
* **Response (503):** `{ "status": "unavailable", "database": "disconnected", "timestamp": "..." }`

---

> **Tổng kết envelope:** Khối public/customer/admin/staff/AI dùng `{ success, data }` (kèm `message`/`meta`/`pagination`/`stats`/`breakdown` tùy endpoint). Khối Partner Portal (`/api/partners/...`, trừ một số response có `success`) trả object phẳng. Khi tích hợp FE nên đọc linh hoạt cả hai dạng theo bảng trên.
