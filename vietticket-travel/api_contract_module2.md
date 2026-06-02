# API Contract - Module 2: Quản lý Địa điểm & Sản phẩm Vé
> **Tài liệu dùng chung cho nhóm Phát triển (Hoàng Anh, Lộc, Phú, Như)**
> * Phú (Backend): Triển khai đúng các Router và kiểu trả về (JSON).
> * Hoàng Anh, Lộc, Như (Frontend): Sử dụng cấu trúc JSON mẫu dưới đây để giả lập dữ liệu (Mock Data) và phát triển giao diện song song.

---

## 📌 Thiết lập Chung (General Setup)
* **Base URL:** `/api/v1`
* **Định dạng dữ liệu:** `application/json`
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
