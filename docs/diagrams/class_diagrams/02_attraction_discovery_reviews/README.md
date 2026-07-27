# Module 2. Public Attraction Discovery, Favorites, and Reviews Module

Module này phục vụ luồng public discovery của attraction, bản đồ, danh sách yêu thích, review công khai, review của customer, phản hồi của partner và moderation/stats review.

Model Class Diagram cho 11 chuc nang. Quy tac ve: [../README.md](../README.md).

| # | Chuc nang | Model trong so do | Diagram |
|---|---|---|---|
| 2.1 | Search Attractions | `Attraction`, `AttractionImage`, `TicketProduct`, `AttractionCategory`, `Category` | [PNG](2_1_search-attractions-model-class-diagram.png) · [PUML](2_1_search-attractions-model-class-diagram.puml) |
| 2.2 | View Map Points | `Attraction`, `AttractionImage`, `TicketProduct` | [PNG](2_2_view-map-points-model-class-diagram.png) · [PUML](2_2_view-map-points-model-class-diagram.puml) |
| 2.3 | View Attraction Detail | `Attraction`, `Category`, `AttractionImage`, `AttractionCategory`, `TicketProduct` | [PNG](2_3_view-attraction-detail-model-class-diagram.png) · [PUML](2_3_view-attraction-detail-model-class-diagram.puml) |
| 2.4 | List Favorites | `User`, `FavoriteAttraction`, `Attraction`, `AttractionImage`, `TicketProduct` | [PNG](2_4_list-favorites-model-class-diagram.png) · [PUML](2_4_list-favorites-model-class-diagram.puml) |
| 2.5 | Toggle Favorite | `Attraction`, `FavoriteAttraction`, `User` | [PNG](2_5_toggle-favorite-model-class-diagram.png) · [PUML](2_5_toggle-favorite-model-class-diagram.puml) |
| 2.6 | List Public Reviews | `Review`, `User`, `UserProfile` | [PNG](2_6_list-public-reviews-model-class-diagram.png) · [PUML](2_6_list-public-reviews-model-class-diagram.puml) |
| 2.7 | Create Review | `User`, `Booking`, `Reservation`, `TicketProduct`, `TimeSlot`, `Review`, `Attraction` | [PNG](2_7_create-review-model-class-diagram.png) · [PUML](2_7_create-review-model-class-diagram.puml) |
| 2.8 | Reply Review | `User`, `PartnerProfile`, `Review`, `Attraction` | [PNG](2_8_reply-review-model-class-diagram.png) · [PUML](2_8_reply-review-model-class-diagram.puml) |
| 2.9 | Moderate Review | `Review`, `Attraction`, `User` | [PNG](2_9_moderate-review-model-class-diagram.png) · [PUML](2_9_moderate-review-model-class-diagram.puml) |
| 2.10 | List Partner Reviews | `User`, `PartnerProfile`, `Review`, `Attraction`, `UserProfile` | [PNG](2_10_list-partner-reviews-model-class-diagram.png) · [PUML](2_10_list-partner-reviews-model-class-diagram.puml) |
| 2.11 | Partner Review Statistics | `User`, `PartnerProfile`, `Review`, `Attraction` | [PNG](2_11_partner-review-statistics-model-class-diagram.png) · [PUML](2_11_partner-review-statistics-model-class-diagram.puml) |
