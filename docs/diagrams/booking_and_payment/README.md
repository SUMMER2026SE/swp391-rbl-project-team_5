# 3.4 Booking and Payment — Swimlane Activity Diagrams

Mỗi use case (màn hình chức năng) trong mục **3.4 Booking and Payment** của SRS có một Swimlane
Activity Diagram riêng, dựng theo cả SRS lẫn mã nguồn thật (endpoint `/api/bookings`,
`/api/payments`, `/api/tickets`; trạng thái Reservation/Booking; VNPay IPN + return; business rules).

Nguồn logic: `backend/src/controllers/bookingController.js`, `paymentController.js`,
`routes/bookingRoutes.js`, `routes/paymentRoutes.js`. Mô hình kho vé chống oversell dùng
transaction Serializable (HELD → BOOKED).

Mỗi diagram có **1 điểm bắt đầu và 1 điểm kết thúc** duy nhất. File `.puml` là nguồn PlantUML,
`.png` là ảnh đã render.

| # | Use case | File |
|---|----------|------|
| 3.4.1 | Ticket Booking (reserve/hold 10 phút) | `34_01_ticket_booking` |
| 3.4.2 | Checkout (contact + voucher + pay) | `34_02_checkout` |
| 3.4.3 | Online Payment - VNPay (return + IPN) | `34_03_online_payment_vnpay` |
| 3.4.4 | Booking Success | `34_04_booking_success` |
| 3.4.5 | My Tickets | `34_05_my_tickets` |
| 3.4.6 | E-Ticket Detail | `34_06_eticket_detail` |
| 3.4.7 | Refund Request | `34_07_refund_request` |

## Render lại

```bash
hex=$(xxd -p 34_03_online_payment_vnpay.puml | tr -d '\n')
curl -s -o 34_03_online_payment_vnpay.png "https://www.plantuml.com/plantuml/png/~h$hex"
```

Hoặc dán nội dung `.puml` vào https://www.plantuml.com/plantuml.
