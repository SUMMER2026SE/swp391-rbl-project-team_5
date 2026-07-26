# Module 5. Booking, Payment, and Refund Module

Module này xử lý checkout từ reservation, voucher, booking, VNPay payment, duyệt booking thủ công và refund.

Model Class Diagram cho 13 chuc nang. Quy tac ve: [../README.md](../README.md).

| # | Chuc nang | Model trong so do | Diagram |
|---|---|---|---|
| 5.1 | Get Reservation Checkout | `Reservation`, `User`, `UserProfile`, `TicketProduct`, `Attraction`, `AttractionImage`, `TimeSlot` | [PNG](5_1_get-reservation-checkout-model-class-diagram.png) · [PUML](5_1_get-reservation-checkout-model-class-diagram.puml) |
| 5.2 | Apply Voucher | `Voucher` | [PNG](5_2_apply-voucher-model-class-diagram.png) · [PUML](5_2_apply-voucher-model-class-diagram.puml) |
| 5.3 | Create Booking | `Reservation`, `Booking`, `Voucher`, `TicketProduct`, `Attraction`, `TimeSlot`, `AttractionImage` | [PNG](5_3_create-booking-model-class-diagram.png) · [PUML](5_3_create-booking-model-class-diagram.puml) |
| 5.4 | List Customer Bookings | `Booking`, `Reservation`, `TicketProduct`, `Attraction`, `AttractionImage`, `Payment`, `TicketInstance` | [PNG](5_4_list-customer-bookings-model-class-diagram.png) · [PUML](5_4_list-customer-bookings-model-class-diagram.puml) |
| 5.5 | View Booking Detail | `Booking`, `Reservation`, `TicketProduct`, `Attraction`, `Payment`, `TicketInstance`, `Voucher` | [PNG](5_5_view-booking-detail-model-class-diagram.png) · [PUML](5_5_view-booking-detail-model-class-diagram.puml) |
| 5.6 | Create VNPay Payment URL | `Booking`, `Reservation`, `Payment` | [PNG](5_6_create-vnpay-payment-url-model-class-diagram.png) · [PUML](5_6_create-vnpay-payment-url-model-class-diagram.puml) |
| 5.7 | Handle VNPay IPN | `Payment`, `Booking`, `Reservation`, `RefundRequest`, `RefundTransaction`, `TicketInstance` | [PNG](5_7_handle-vnpay-ipn-model-class-diagram.png) · [PUML](5_7_handle-vnpay-ipn-model-class-diagram.puml) |
| 5.8 | Handle VNPay Return | `Booking`, `Payment`, `Reservation`, `TicketInstance`, `RefundRequest`, `RefundTransaction` | [PNG](5_8_handle-vnpay-return-model-class-diagram.png) · [PUML](5_8_handle-vnpay-return-model-class-diagram.puml) |
| 5.9 | List Partner Bookings | `Attraction`, `TicketProduct`, `Reservation`, `Booking`, `Payment`, `RefundRequest`, `TicketInstance` | [PNG](5_9_list-partner-bookings-model-class-diagram.png) · [PUML](5_9_list-partner-bookings-model-class-diagram.puml) |
| 5.10 | Partner Approve Booking | `Booking`, `Reservation`, `TicketProduct`, `Attraction`, `TicketInstance`, `DailyStock`, `AttractionDailyStock` | [PNG](5_10_partner-approve-booking-model-class-diagram.png) · [PUML](5_10_partner-approve-booking-model-class-diagram.puml) |
| 5.11 | Partner Reject Booking | `Booking`, `RefundRequest`, `Reservation`, `DailyStock`, `AttractionDailyStock`, `TimeSlotStock`, `Voucher`, `Attraction`, `TicketProduct`, `TimeSlot` | [PNG](5_11_partner-reject-booking-model-class-diagram.png) · [PUML](5_11_partner-reject-booking-model-class-diagram.puml) |
| 5.12 | Get Refund Preview | `Booking`, `Reservation`, `TicketProduct`, `RefundRequest` | [PNG](5_12_get-refund-preview-model-class-diagram.png) · [PUML](5_12_get-refund-preview-model-class-diagram.puml) |
| 5.13 | Create Refund Request | `Booking`, `Reservation`, `TicketProduct`, `RefundRequest` | [PNG](5_13_create-refund-request-model-class-diagram.png) · [PUML](5_13_create-refund-request-model-class-diagram.puml) |
