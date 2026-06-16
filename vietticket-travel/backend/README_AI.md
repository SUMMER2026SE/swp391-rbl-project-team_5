# AI Assistant Module — VietTicket Travel

Module này thêm 3 chức năng AI vào backend, dùng LLM API (Gemini ↔ OpenAI,
tự fallback) — **không cần training/Colab**.

## Các file mới

```
backend/src/
├── services/
│   ├── llmClient.js          # Lớp gọi LLM dùng chung (Gemini + OpenAI fallback)
│   ├── aiCatalogService.js   # Lấy dữ liệu attraction/ticket từ DB cho prompt
│   ├── platformPolicy.js     # Nội dung chính sách/FAQ cho chatbot
│   └── aiAssistantService.js # 3 service chính: chat, recommend, itinerary
├── controllers/
│   └── aiAssistantController.js
└── routes/
    └── aiRoutes.js            # mounted tại /api/ai
```

Đã chỉnh sửa: `backend/src/app.js` (mount route), `backend/.env.example`
(thêm biến môi trường AI).

## Cấu hình `.env`

```
GEMINI_API_KEY="..."
OPENAI_API_KEY="..."
AI_PRIMARY_PROVIDER="gemini"   # hoặc "openai"
GEMINI_MODEL="gemini-2.0-flash"
OPENAI_MODEL="gpt-4o-mini"
```

Chỉ cần điền 1 trong 2 API key cũng chạy được. Điền cả 2 để có fallback
(nếu provider chính lỗi/hết quota, hệ thống tự gọi provider phụ).

- Lấy Gemini API key (free tier): https://aistudio.google.com/app/apikey
- Lấy OpenAI API key: https://platform.openai.com/api-keys

## API Endpoints

### 1. Chatbot tư vấn — `POST /api/ai/chat`

```json
// Request
{
  "message": "Chính sách hoàn vé như thế nào?",
  "history": [
    { "role": "user", "content": "Cho mình hỏi về vé Bà Nà Hills" },
    { "role": "assistant", "content": "Vé Bà Nà Hills hiện có giá..." }
  ]
}

// Response
{
  "success": true,
  "data": {
    "reply": "Chính sách hoàn vé tùy theo loại vé bạn đặt...",
    "provider": "gemini"
  }
}
```

`history` là tùy chọn (mảng các lượt hội thoại trước, tối đa 10 lượt gần nhất
được dùng).

### 2. Gợi ý địa điểm + combo vé — `POST /api/ai/recommend`

```json
// Request
{
  "budget": 2000000,
  "people": 4,
  "city": "Đà Nẵng",
  "interests": "thiên nhiên"
}

// Response
{
  "success": true,
  "provider": "gemini",
  "data": {
    "recommendedAttractions": [
      { "attractionId": "...", "title": "Sun World Ba Na Hills", "reason": "..." }
    ],
    "combos": [
      {
        "attractionId": "...",
        "attractionTitle": "Sun World Ba Na Hills",
        "items": [
          { "ticketId": "...", "ticketName": "Vé người lớn", "quantity": 2, "unitPrice": 850000, "subtotal": 1700000 }
        ],
        "totalPrice": 1700000,
        "note": ""
      }
    ],
    "overallSummary": "Với 2.000.000đ cho 4 người..."
  }
}
```

`city` và `interests` là tùy chọn (nếu bỏ trống sẽ lấy các điểm tham quan
nổi bật nhất nói chung).

### 3. Tạo kế hoạch tham quan — `POST /api/ai/itinerary`

```json
// Request
{
  "city": "Đà Nẵng",
  "days": 3,
  "people": 2,
  "interests": "văn hóa, ẩm thực"
}

// Response
{
  "success": true,
  "provider": "openai",
  "data": {
    "title": "Khám phá Đà Nẵng 3 ngày 2 đêm",
    "days": [
      {
        "day": 1,
        "theme": "Trải nghiệm Bà Nà Hills",
        "activities": [
          {
            "attractionId": "...",
            "title": "Sun World Ba Na Hills",
            "timeSlot": "Sáng",
            "suggestedTime": "08:00 - 12:00",
            "notes": "Nên đi sớm để tránh đông"
          }
        ]
      }
    ],
    "estimatedCost": { "perPerson": 1500000, "total": 3000000, "note": "Chỉ tính giá vé" },
    "tips": ["Mang giày thể thao", "Đặt vé trước để tránh hết chỗ"]
  }
}
```

## Cách hoạt động & lưu ý

- Cả 3 chức năng đều **lấy dữ liệu thật từ DB** (bảng `Attraction`,
  `TicketProduct` đang `ACTIVE`) qua `aiCatalogService.js`, đưa vào prompt,
  rồi yêu cầu LLM trả về JSON theo schema cố định — service parse trực tiếp,
  không cần hậu xử lý phức tạp.
- `recommend` và `itinerary` validate dữ liệu LLM trả về dựa trên catalog đã
  gửi (LLM được yêu cầu chỉ dùng `attractionId`/`ticketId` có trong danh
  sách) — nên hạn chế được tình trạng "bịa" id không tồn tại.
- Nếu cả Gemini và OpenAI đều lỗi (hết quota, sai key...), API trả lỗi 500
  với message rõ ràng — controller dùng `next(error)` nên sẽ đi qua
  `errorHandler` chung của app.
- Routes hiện đang **public** (không yêu cầu đăng nhập) để chatbot/gợi ý
  dùng được cho khách chưa có tài khoản. Có thể thêm `protect` middleware
  nếu muốn giới hạn cho user đã login.
- Phần **dự đoán doanh thu** chưa nằm trong module này — sẽ làm ở bước sau.

## Test nhanh (sau khi chạy `npm run dev`)

```bash
curl -X POST http://localhost:5000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Chính sách hoàn vé như thế nào?"}'

curl -X POST http://localhost:5000/api/ai/recommend \
  -H "Content-Type: application/json" \
  -d '{"budget": 2000000, "people": 4, "city": "Đà Nẵng"}'

curl -X POST http://localhost:5000/api/ai/itinerary \
  -H "Content-Type: application/json" \
  -d '{"city": "Đà Nẵng", "days": 3, "people": 2}'
```
