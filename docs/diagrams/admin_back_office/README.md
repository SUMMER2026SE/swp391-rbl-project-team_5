# 3.9 Admin Back-Office — Swimlane Activity Diagrams

Use case trong mục **3.9 Admin Back-Office** của SRS, dựng theo SRS + mã nguồn thật
(endpoint `/api/admin/*`, bảo vệ role ADMIN). Mỗi diagram có **1 start / 1 end**. Nguồn logic:
`backend/src/routes/adminRoutes.js`, `controllers/adminController.js`, `reviewController.js`.

| # | Use case | File |
|---|----------|------|
| 3.9.1 | Admin Dashboard | `39_01_admin_dashboard` |
| 3.9.2 | User Management (lock/unlock) | `39_02_user_management` |
| 3.9.3 | Partner KYC Approval | `39_03_partner_kyc_approval` |
| 3.9.4 | Attraction Approval | `39_04_attraction_approval` |
| 3.9.5 | Category Management | `39_05_category_management` |
| 3.9.6 | Booking Management | `39_06_booking_management` |
| 3.9.7 | Review Moderation | `39_07_review_moderation` |
| 3.9.8 | Violation Management (hide/suspend) | `39_08_violation_management` |

Render lại: `hex=$(xxd -p FILE.puml | tr -d '\n'); curl -s -o FILE.png "https://www.plantuml.com/plantuml/png/~h$hex"`
