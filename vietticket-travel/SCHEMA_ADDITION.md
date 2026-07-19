# Thêm vào backend/prisma/schema.prisma

## 0. Thêm field `tier` vào Attraction (CẦN THIẾT cho ml-service)

ml-service dùng `tier` (BASIC/STANDARD/PREMIUM) làm feature one-hot, nhưng
schema hiện tại của Attraction CHƯA có field này. Thêm:

```prisma
enum AttractionTier {
  BASIC
  STANDARD
  PREMIUM
}

model Attraction {
  // ...các field hiện có giữ nguyên...
  tier AttractionTier @default(STANDARD) // <-- THÊM DÒNG NÀY (Partner/Admin có thể chỉnh sau)
}
```

`@default(STANDARD)` giúp migrate an toàn cho các attraction đã tồn tại, không
cần backfill thủ công. Nếu team muốn tự động suy ra tier theo `minTicketPrice`
thay vì để Partner chọn tay, có thể bỏ field này và thay bằng hàm helper phía
`forecastService.js` — nhưng khuyến nghị giữ field tay vì tier còn có thể dùng
cho hiển thị UI (badge "PREMIUM" trên trang chi tiết) chứ không chỉ riêng ML.

## 1. Thêm relation vào model Attraction (đã có sẵn trong schema)

Tìm khối relation trong `model Attraction { ... }`, ví dụ ngay dưới dòng `staffAssignments`,
thêm 1 dòng:

```prisma
model Attraction {
  // ...các field hiện có giữ nguyên...

  dailyStocks      AttractionDailyStock[]
  staffAssignments StaffAttractionAssignment[]
  forecasts        RevenueForecast[]   // <-- THÊM DÒNG NÀY
}
```

## 2. Thêm model mới ở cuối file schema.prisma

```prisma
enum ForecastModelVersion {
  V1
}

model RevenueForecast {
  id                String   @id @default(uuid())
  attractionId      String
  forecastDate      DateTime @db.Date // ngày được dự đoán (tương lai)
  predictedRevenue  Decimal  @db.Decimal(14, 2)
  rfPrediction      Decimal  @db.Decimal(14, 2)
  xgbPrediction     Decimal  @db.Decimal(14, 2)
  confidenceLow     Decimal  @db.Decimal(14, 2)
  confidenceHigh    Decimal  @db.Decimal(14, 2)
  predictedBookings Int?
  modelVersion      String // vd "v20260702" — khớp metadata.json bên ml-service
  usedFallback      Boolean  @default(false) // true nếu tại thời điểm generate, ML service down
  generatedAt       DateTime @default(now())

  attraction Attraction @relation(fields: [attractionId], references: [id], onDelete: Cascade)

  // Mỗi lần refresh sẽ upsert theo (attractionId, forecastDate) — không tích lũy rác
  @@unique([attractionId, forecastDate])
  @@index([attractionId])
  @@index([forecastDate])
}
```

Sau khi thêm, chạy:

```bash
cd backend
npx prisma migrate dev --name add_revenue_forecast
```

> Đây chính là TASK 2 trong `TASKS_FORECAST_COPILOT.md` — Copilot chỉ cần chạy lệnh
> migrate, không tự sửa model.
