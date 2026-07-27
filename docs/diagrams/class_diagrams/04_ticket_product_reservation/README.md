# Module 4. Ticket Product, Schedule, and Reservation Module

Module này quản lý sản phẩm vé, lịch mở bán, time slot, kiểm tra tồn kho và giữ chỗ.

Model Class Diagram cho 11 chuc nang. Quy tac ve: [../README.md](../README.md).

| # | Chuc nang | Model trong so do | Diagram |
|---|---|---|---|
| 4.1 | List Ticket Products | `Attraction`, `TicketProduct` | [PNG](4_1_list-ticket-products-model-class-diagram.png) · [PUML](4_1_list-ticket-products-model-class-diagram.puml) |
| 4.2 | Create Ticket Product | `Attraction`, `TicketProduct` | [PNG](4_2_create-ticket-product-model-class-diagram.png) · [PUML](4_2_create-ticket-product-model-class-diagram.puml) |
| 4.3 | View Ticket Product | `TicketProduct`, `Attraction` | [PNG](4_3_view-ticket-product-model-class-diagram.png) · [PUML](4_3_view-ticket-product-model-class-diagram.puml) |
| 4.4 | Update Ticket Product | `Attraction`, `TicketProduct` | [PNG](4_4_update-ticket-product-model-class-diagram.png) · [PUML](4_4_update-ticket-product-model-class-diagram.puml) |
| 4.5 | Archive Ticket Product | `Attraction`, `TicketProduct` | [PNG](4_5_archive-ticket-product-model-class-diagram.png) · [PUML](4_5_archive-ticket-product-model-class-diagram.puml) |
| 4.6 | Create Ticket Product by Nested Attraction Route | `Attraction`, `PartnerProfile`, `TicketProduct` | [PNG](4_6_create-ticket-product-by-nested-attraction-route-model-class-diagram.png) · [PUML](4_6_create-ticket-product-by-nested-attraction-route-model-class-diagram.puml) |
| 4.7 | Get Attraction Schedule | `Attraction`, `TimeSlot`, `SpecialDate` | [PNG](4_7_get-attraction-schedule-model-class-diagram.png) · [PUML](4_7_get-attraction-schedule-model-class-diagram.puml) |
| 4.8 | Save Attraction Schedule | `Attraction`, `TimeSlot`, `SpecialDate` | [PNG](4_8_save-attraction-schedule-model-class-diagram.png) · [PUML](4_8_save-attraction-schedule-model-class-diagram.puml) |
| 4.9 | Setup Time Slots | `TicketProduct`, `Attraction`, `PartnerProfile`, `TimeSlot` | [PNG](4_9_setup-time-slots-model-class-diagram.png) · [PUML](4_9_setup-time-slots-model-class-diagram.puml) |
| 4.10 | Check Ticket Availability | `Attraction`, `DailyStock`, `AttractionDailyStock`, `TimeSlotStock`, `TicketProduct`, `TimeSlot`, `SpecialDate` | [PNG](4_10_check-ticket-availability-model-class-diagram.png) · [PUML](4_10_check-ticket-availability-model-class-diagram.puml) |
| 4.11 | Reserve Tickets | `Reservation`, `DailyStock`, `AttractionDailyStock`, `TimeSlotStock`, `TicketProduct`, `Attraction`, `TimeSlot` | [PNG](4_11_reserve-tickets-model-class-diagram.png) · [PUML](4_11_reserve-tickets-model-class-diagram.puml) |
