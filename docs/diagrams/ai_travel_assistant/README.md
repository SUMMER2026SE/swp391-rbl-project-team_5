# 3.5 AI Travel Assistant — Swimlane Activity Diagrams

Mỗi use case trong mục **3.5 AI Travel Assistant** của SRS có một Swimlane Activity Diagram riêng,
dựng theo cả SRS lẫn mã nguồn thật. Module dùng LLM **Google Gemini** grounded theo catalogue,
phục vụ bởi các endpoint `/api/ai/*` (đều rate-limited).

Nguồn logic: `backend/src/routes/aiRoutes.js`, `controllers/aiAssistantController.js`,
`services/aiAssistantService.js`, `services/aiCatalogService.js`.
- `POST /api/ai/itinerary`, `POST /api/ai/itinerary/save`, `GET/DELETE /api/ai/itinerary/saved` — yêu cầu đăng nhập.
- `POST /api/ai/recommend`, `POST /api/ai/chat` — optional auth.

Mỗi diagram có **1 điểm bắt đầu và 1 điểm kết thúc** duy nhất.

| # | Use case | File |
|---|----------|------|
| 3.5.1 | AI Itinerary Planner | `35_01_ai_itinerary_planner` |
| 3.5.2 | AI Attraction Recommendations | `35_02_ai_recommendations` |
| 3.5.3 | AI Chatbot | `35_03_ai_chatbot` |

## Render lại

```bash
hex=$(xxd -p 35_01_ai_itinerary_planner.puml | tr -d '\n')
curl -s -o 35_01_ai_itinerary_planner.png "https://www.plantuml.com/plantuml/png/~h$hex"
```

Hoặc dán nội dung `.puml` vào https://www.plantuml.com/plantuml.
