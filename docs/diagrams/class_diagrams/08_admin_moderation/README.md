# Module 8. Admin Management and Moderation Module

Module này là backend quản trị nền tảng: dashboard, user, partner KYC, attraction moderation, booking, category và review moderation.

Model Class Diagram cho 14 chuc nang. Quy tac ve: [../README.md](../README.md).

| # | Chuc nang | Model trong so do | Diagram |
|---|---|---|---|
| 8.1 | Admin Dashboard | `User`, `Attraction`, `PartnerProfile`, `Booking`, `Payment` | [PNG](8_1_admin-dashboard-model-class-diagram.png) · [PUML](8_1_admin-dashboard-model-class-diagram.puml) |
| 8.2 | List Users | `User`, `UserProfile` | [PNG](8_2_list-users-model-class-diagram.png) · [PUML](8_2_list-users-model-class-diagram.puml) |
| 8.3 | Change User Status | `User`, `AuthSession` | [PNG](8_3_change-user-status-model-class-diagram.png) · [PUML](8_3_change-user-status-model-class-diagram.puml) |
| 8.4 | List Partner Profiles | `PartnerProfile`, `User`, `UserProfile` | [PNG](8_4_list-partner-profiles-model-class-diagram.png) · [PUML](8_4_list-partner-profiles-model-class-diagram.puml) |
| 8.5 | Review Partner KYC | `PartnerProfile`, `User` | [PNG](8_5_review-partner-kyc-model-class-diagram.png) · [PUML](8_5_review-partner-kyc-model-class-diagram.puml) |
| 8.6 | List Attractions for Moderation | `Attraction`, `User`, `AttractionImage`, `AttractionCategory`, `Category`, `TicketProduct`, `AuditLog` | [PNG](8_6_list-attractions-for-moderation-model-class-diagram.png) · [PUML](8_6_list-attractions-for-moderation-model-class-diagram.puml) |
| 8.7 | Review Attraction Submission | `Attraction`, `Category`, `AttractionCategory`, `AttractionImage`, `TicketProduct`, `TimeSlot`, `SpecialDate` | [PNG](8_7_review-attraction-submission-model-class-diagram.png) · [PUML](8_7_review-attraction-submission-model-class-diagram.puml) |
| 8.8 | Hide Attraction | `Attraction`, `User`, `AuditLog` | [PNG](8_8_hide-attraction-model-class-diagram.png) · [PUML](8_8_hide-attraction-model-class-diagram.puml) |
| 8.9 | Admin Booking Management | `Booking`, `Payment`, `RefundRequest`, `TicketInstance`, `Reservation`, `TimeSlot`, `TicketProduct` | [PNG](8_9_admin-booking-management-model-class-diagram.png) · [PUML](8_9_admin-booking-management-model-class-diagram.puml) |
| 8.10 | List Categories | `Category`, `Attraction`, `AttractionCategory` | [PNG](8_10_list-categories-model-class-diagram.png) · [PUML](8_10_list-categories-model-class-diagram.puml) |
| 8.11 | Create Category | `Category` | [PNG](8_11_create-category-model-class-diagram.png) · [PUML](8_11_create-category-model-class-diagram.puml) |
| 8.12 | Update Category | `Category` | [PNG](8_12_update-category-model-class-diagram.png) · [PUML](8_12_update-category-model-class-diagram.puml) |
| 8.13 | Delete Category | `Category`, `AttractionCategory` | [PNG](8_13_delete-category-model-class-diagram.png) · [PUML](8_13_delete-category-model-class-diagram.puml) |
| 8.14 | List Admin Reviews | `Review`, `User`, `Attraction` | [PNG](8_14_list-admin-reviews-model-class-diagram.png) · [PUML](8_14_list-admin-reviews-model-class-diagram.puml) |
