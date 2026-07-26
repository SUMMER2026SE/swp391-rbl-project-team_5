# Module 3. Partner Profile and Attraction Management Module

Module này quản lý partner portal: nộp KYC, hồ sơ/cài đặt đối tác, dashboard/report, CRUD attraction, quản lý ảnh, category, gửi duyệt và bật/tạm dừng publication.

Model Class Diagram cho 16 chuc nang. Quy tac ve: [../README.md](../README.md).

| # | Chuc nang | Model trong so do | Diagram |
|---|---|---|---|
| 3.1 | Submit Partner KYC | `User`, `PartnerProfile`, `UserProfile` | [PNG](3_1_submit-partner-kyc-model-class-diagram.png) · [PUML](3_1_submit-partner-kyc-model-class-diagram.puml) |
| 3.2 | Get My Partner Profile | `User`, `AuthSession`, `UserProfile` | [PNG](3_2_get-my-partner-profile-model-class-diagram.png) · [PUML](3_2_get-my-partner-profile-model-class-diagram.puml) |
| 3.3 | Update Partner Settings | `PartnerProfile`, `User`, `UserProfile` | [PNG](3_3_update-partner-settings-model-class-diagram.png) · [PUML](3_3_update-partner-settings-model-class-diagram.puml) |
| 3.4 | Partner Dashboard | `Attraction`, `TicketProduct`, `Reservation`, `Booking`, `Payment`, `DailyStock`, `RefundRequest` | [PNG](3_4_partner-dashboard-model-class-diagram.png) · [PUML](3_4_partner-dashboard-model-class-diagram.puml) |
| 3.5 | Partner Reports | `Booking`, `Reservation`, `TicketProduct`, `Attraction`, `Payment` | [PNG](3_5_partner-reports-model-class-diagram.png) · [PUML](3_5_partner-reports-model-class-diagram.puml) |
| 3.6 | List Partner Attractions | `Attraction`, `AttractionImage`, `AttractionCategory`, `TicketProduct`, `TimeSlot`, `SpecialDate`, `Category` | [PNG](3_6_list-partner-attractions-model-class-diagram.png) · [PUML](3_6_list-partner-attractions-model-class-diagram.puml) |
| 3.7 | View Partner Attraction Detail | `Attraction`, `AttractionImage`, `AttractionCategory`, `TicketProduct`, `TimeSlot`, `SpecialDate`, `Category` | [PNG](3_7_view-partner-attraction-detail-model-class-diagram.png) · [PUML](3_7_view-partner-attraction-detail-model-class-diagram.puml) |
| 3.8 | Create Attraction Draft | `Attraction`, `Category`, `AttractionCategory`, `AttractionImage` | [PNG](3_8_create-attraction-draft-model-class-diagram.png) · [PUML](3_8_create-attraction-draft-model-class-diagram.puml) |
| 3.9 | Update Attraction | `Attraction`, `AttractionCategory`, `AttractionImage`, `TicketProduct`, `TimeSlot`, `SpecialDate`, `Category` | [PNG](3_9_update-attraction-model-class-diagram.png) · [PUML](3_9_update-attraction-model-class-diagram.puml) |
| 3.10 | Archive Attraction | `Attraction`, `Booking` | [PNG](3_10_archive-attraction-model-class-diagram.png) · [PUML](3_10_archive-attraction-model-class-diagram.puml) |
| 3.11 | Upload Attraction Images | `Attraction`, `AttractionImage` | [PNG](3_11_upload-attraction-images-model-class-diagram.png) · [PUML](3_11_upload-attraction-images-model-class-diagram.puml) |
| 3.12 | Delete Attraction Image | `Attraction`, `AttractionImage` | [PNG](3_12_delete-attraction-image-model-class-diagram.png) · [PUML](3_12_delete-attraction-image-model-class-diagram.puml) |
| 3.13 | Set Primary Attraction Image | `Attraction`, `AttractionImage` | [PNG](3_13_set-primary-attraction-image-model-class-diagram.png) · [PUML](3_13_set-primary-attraction-image-model-class-diagram.puml) |
| 3.14 | List Active Categories | `Category` | [PNG](3_14_list-active-categories-model-class-diagram.png) · [PUML](3_14_list-active-categories-model-class-diagram.puml) |
| 3.15 | Submit Attraction for Admin Review | `PartnerProfile`, `Attraction`, `AttractionImage`, `AttractionCategory`, `Category`, `TicketProduct`, `TimeSlot` | [PNG](3_15_submit-attraction-for-admin-review-model-class-diagram.png) · [PUML](3_15_submit-attraction-for-admin-review-model-class-diagram.puml) |
| 3.16 | Set Attraction Publication Status | `Attraction` | [PNG](3_16_set-attraction-publication-status-model-class-diagram.png) · [PUML](3_16_set-attraction-publication-status-model-class-diagram.puml) |
