# 3.7 Customer Support — Swimlane Activity Diagrams

Use case trong mục **3.7 Customer Support** của SRS, dựng theo SRS + mã nguồn thật
(endpoint `/api/support/*`). Mỗi diagram có **1 start / 1 end**. Nguồn logic:
`backend/src/routes/supportRoutes.js`, `controllers/supportController.js`.

| # | Use case | File |
|---|----------|------|
| 3.7.1 | Support Center | `37_01_support_center` |
| 3.7.2 | My Support Tickets | `37_02_my_support_tickets` |

Render lại: `hex=$(xxd -p FILE.puml | tr -d '\n'); curl -s -o FILE.png "https://www.plantuml.com/plantuml/png/~h$hex"`
