# 3.8 Staff Operations — Swimlane Activity Diagrams

Use case trong mục **3.8 Staff Operations** của SRS, dựng theo SRS + mã nguồn thật
(endpoint `/api/staff/*`, `/api/support/*`). Partner staff check-in vé; platform staff xử lý
hoàn tiền và support ticket. Mỗi diagram có **1 start / 1 end**. Nguồn logic:
`backend/src/routes/staffRoutes.js`, `controllers/staffController.js`, `supportController.js`.

| # | Use case | File |
|---|----------|------|
| 3.8.1 | Ticket Check-in (QR, mark USED) | `38_01_ticket_checkin` |
| 3.8.2 | Refund Management (approve/reject) | `38_02_refund_management` |
| 3.8.3 | Support Ticket Handling | `38_03_support_ticket_handling` |

Render lại: `hex=$(xxd -p FILE.puml | tr -d '\n'); curl -s -o FILE.png "https://www.plantuml.com/plantuml/png/~h$hex"`
