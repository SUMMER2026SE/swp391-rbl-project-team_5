# 3.2 Authentication and Profile Management — Swimlane Activity Diagrams

Use case trong mục **3.2 Authentication and Profile Management** của SRS, dựng theo SRS + mã nguồn
thật (endpoint `/api/auth/*`, `/api/users/*`; Google Identity OAuth2; JWT; bcrypt; token 30 phút).
Mỗi diagram có **1 start / 1 end**. Nguồn logic: `backend/src/routes/authRoutes.js`,
`routes/userRoutes.js`, `controllers/authController.js`.

| # | Use case | File |
|---|----------|------|
| 3.2.1 | Sign In (email/password + Google) | `32_01_sign_in` |
| 3.2.2 | Register Account | `32_02_register_account` |
| 3.2.3 | Verify Email | `32_03_verify_email` |
| 3.2.4 | Forgot Password | `32_04_forgot_password` |
| 3.2.5 | Reset Password | `32_05_reset_password` |
| 3.2.6 | View Profile | `32_06_view_profile` |
| 3.2.7 | Edit Profile (avatar + info) | `32_07_edit_profile` |
| 3.2.8 | Change Password | `32_08_change_password` |

Render lại: `hex=$(xxd -p FILE.puml | tr -d '\n'); curl -s -o FILE.png "https://www.plantuml.com/plantuml/png/~h$hex"`
