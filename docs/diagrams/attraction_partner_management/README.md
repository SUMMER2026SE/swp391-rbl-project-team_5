# 3.6 Attraction Partner Management — Swimlane Activity Diagrams

Mỗi use case (màn hình chức năng) trong mục **3.6 Attraction Partner Management** của SRS có
một Swimlane Activity Diagram riêng, dựng theo cả SRS lẫn mã nguồn thật (endpoint `/api/partners/*`,
trạng thái `PartnerProfile` / `Attraction`, toast lỗi, business rules).

Nguồn logic: `backend/src/controllers/partnerController.js`, `attractionController.js`,
`adminController.js`, `services/attractionWorkflowService.js`, `routes/partnerRoutes.js`.

Mỗi diagram có **1 điểm bắt đầu và 1 điểm kết thúc** duy nhất. File `.puml` là nguồn PlantUML,
`.png` là ảnh đã render.

| # | Use case | File |
|---|----------|------|
| 3.6.1 | Partner Registration | `36_01_partner_registration` |
| 3.6.2 | Partner Verification (KYC) | `36_02_partner_kyc` |
| 3.6.3 | Partner Pending / Under Review | `36_03_partner_pending` |
| 3.6.4 | Partner Dashboard | `36_04_partner_dashboard` |
| 3.6.5 | Attraction List (Partner) | `36_05_attraction_list` |
| 3.6.6 | Add Attraction | `36_06_add_attraction` |
| 3.6.7 | Edit Attraction | `36_07_edit_attraction` |
| 3.6.8 | Ticket Product Management | `36_08_ticket_product_management` |
| 3.6.9 | Ticket Product Form | `36_09_ticket_product_form` |
| 3.6.10 | Attraction Schedule | `36_10_attraction_schedule` |
| 3.6.11 | Partner Bookings | `36_11_partner_bookings` |
| 3.6.12 | Partner Reviews | `36_12_partner_reviews` |
| 3.6.13 | Staff Management | `36_13_staff_management` |
| 3.6.14 | Revenue Reports | `36_14_revenue_reports` |
| 3.6.15 | Partner Settings | `36_15_partner_settings` |

## Render lại

Cần Java + Graphviz + `plantuml.jar`, hoặc render qua server (không cần cài đặt):

```bash
# render 1 file qua PlantUML server
hex=$(xxd -p 36_06_add_attraction.puml | tr -d '\n')
curl -s -o 36_06_add_attraction.png "https://www.plantuml.com/plantuml/png/~h$hex"
```

Hoặc dán nội dung `.puml` vào https://www.plantuml.com/plantuml.
