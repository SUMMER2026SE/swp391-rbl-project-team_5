# Module 6. Staff Operations and Partner Staff Management Module

Module này bao gồm nghiệp vụ staff nền tảng, check-in vé, xử lý refund, reissue ticket và quản lý nhân viên của partner.

Model Class Diagram cho 15 chuc nang. Quy tac ve: [../README.md](../README.md).

| # | Chuc nang | Model trong so do | Diagram |
|---|---|---|---|
| 6.1 | List Refund Requests | `RefundRequest`, `Booking`, `User`, `Payment`, `Reservation`, `TicketProduct`, `Attraction` | [PNG](6_1_list-refund-requests-model-class-diagram.png) · [PUML](6_1_list-refund-requests-model-class-diagram.puml) |
| 6.2 | Process Refund Request | `RefundRequest`, `RefundTransaction`, `Booking`, `TicketInstance`, `Payment`, `Reservation` | [PNG](6_2_process-refund-request-model-class-diagram.png) · [PUML](6_2_process-refund-request-model-class-diagram.puml) |
| 6.3 | Reissue Ticket | `Booking`, `TicketInstance`, `Reservation`, `TicketProduct`, `Attraction`, `StaffAttractionAssignment` | [PNG](6_3_reissue-ticket-model-class-diagram.png) · [PUML](6_3_reissue-ticket-model-class-diagram.puml) |
| 6.4 | Lookup Ticket by QR | `TicketInstance`, `Booking`, `Reservation`, `TimeSlot`, `TicketProduct`, `Attraction`, `StaffAttractionAssignment` | [PNG](6_4_lookup-ticket-by-qr-model-class-diagram.png) · [PUML](6_4_lookup-ticket-by-qr-model-class-diagram.puml) |
| 6.5 | Check In Ticket | `TicketInstance`, `Booking`, `Reservation`, `TicketProduct`, `Attraction`, `StaffAttractionAssignment` | [PNG](6_5_check-in-ticket-model-class-diagram.png) · [PUML](6_5_check-in-ticket-model-class-diagram.puml) |
| 6.6 | List Today Bookings | `StaffAttractionAssignment`, `Booking`, `Reservation`, `TimeSlot`, `TicketProduct`, `Attraction`, `TicketInstance` | [PNG](6_6_list-today-bookings-model-class-diagram.png) · [PUML](6_6_list-today-bookings-model-class-diagram.puml) |
| 6.7 | Admin List Staff Assignments | `User`, `StaffAttractionAssignment`, `Attraction` | [PNG](6_7_admin-list-staff-assignments-model-class-diagram.png) · [PUML](6_7_admin-list-staff-assignments-model-class-diagram.puml) |
| 6.8 | Admin Replace Staff Assignments | `User`, `Attraction`, `StaffAttractionAssignment`, `AuditLog` | [PNG](6_8_admin-replace-staff-assignments-model-class-diagram.png) · [PUML](6_8_admin-replace-staff-assignments-model-class-diagram.puml) |
| 6.9 | Partner List Staff | `User`, `Attraction`, `UserProfile`, `StaffAttractionAssignment` | [PNG](6_9_partner-list-staff-model-class-diagram.png) · [PUML](6_9_partner-list-staff-model-class-diagram.puml) |
| 6.10 | Partner Create Staff | `User`, `PasswordResetToken`, `UserProfile`, `AuditLog` | [PNG](6_10_partner-create-staff-model-class-diagram.png) · [PUML](6_10_partner-create-staff-model-class-diagram.puml) |
| 6.11 | Resend Staff Invite | `User`, `PasswordResetToken` | [PNG](6_11_resend-staff-invite-model-class-diagram.png) · [PUML](6_11_resend-staff-invite-model-class-diagram.puml) |
| 6.12 | Change Staff Status | `User`, `AuthSession`, `AuditLog`, `StaffAttractionAssignment` | [PNG](6_12_change-staff-status-model-class-diagram.png) · [PUML](6_12_change-staff-status-model-class-diagram.puml) |
| 6.13 | Get Staff Assignments | `Attraction`, `StaffAttractionAssignment`, `User` | [PNG](6_13_get-staff-assignments-model-class-diagram.png) · [PUML](6_13_get-staff-assignments-model-class-diagram.puml) |
| 6.14 | Replace Staff Assignments | `Attraction`, `StaffAttractionAssignment`, `User`, `AuditLog` | [PNG](6_14_replace-staff-assignments-model-class-diagram.png) · [PUML](6_14_replace-staff-assignments-model-class-diagram.puml) |
| 6.15 | Remove Staff | `User`, `StaffAttractionAssignment`, `AuthSession`, `AuditLog` | [PNG](6_15_remove-staff-model-class-diagram.png) · [PUML](6_15_remove-staff-model-class-diagram.puml) |
