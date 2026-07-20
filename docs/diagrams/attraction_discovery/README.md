# 3.3 Attraction Discovery and Favorites — Swimlane Activity Diagrams

Use case trong mục **3.3 Attraction Discovery and Favorites** của SRS, dựng theo SRS + mã nguồn thật
(endpoint công khai `/api/attractions`, `/api/reviews`, `/api/favorites`, `/api/weather`,
`/api/newsletter/subscribe`). Mỗi diagram có **1 start / 1 end**. Nguồn logic:
`backend/src/routes/attractionRoutes.js`, `controllers/attractionController.js`, `favoriteController.js`.

| # | Use case | File |
|---|----------|------|
| 3.3.1 | Home Page | `33_01_home_page` |
| 3.3.2 | Search and Filter Attractions | `33_02_search_filter` |
| 3.3.3 | Attraction Detail | `33_03_attraction_detail` |
| 3.3.4 | Favorite Attractions | `33_04_favorite_attractions` |

Render lại: `hex=$(xxd -p FILE.puml | tr -d '\n'); curl -s -o FILE.png "https://www.plantuml.com/plantuml/png/~h$hex"`
