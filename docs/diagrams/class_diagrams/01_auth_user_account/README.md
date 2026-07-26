# Module 1. Authentication and User Account Module

Module này quản lý đăng ký tài khoản LOCAL, xác thực email, đăng nhập bằng email/password hoặc Google, phiên AuthSession/JWT, quên/đặt lại mật khẩu và hồ sơ cá nhân của người dùng.

Model Class Diagram cho 13 chuc nang. Quy tac ve: [../README.md](../README.md).

| # | Chuc nang | Model trong so do | Diagram |
|---|---|---|---|
| 1.1 | Register Account | `User`, `EmailVerificationToken`, `UserProfile` | [PNG](1_1_register-account-model-class-diagram.png) · [PUML](1_1_register-account-model-class-diagram.puml) |
| 1.2 | Verify Email | `EmailVerificationToken`, `User`, `UserProfile` | [PNG](1_2_verify-email-model-class-diagram.png) · [PUML](1_2_verify-email-model-class-diagram.puml) |
| 1.3 | Resend Verification Email | `User`, `EmailVerificationToken` | [PNG](1_3_resend-verification-email-model-class-diagram.png) · [PUML](1_3_resend-verification-email-model-class-diagram.puml) |
| 1.4 | Login | `User`, `AuthSession`, `UserProfile` | [PNG](1_4_login-model-class-diagram.png) · [PUML](1_4_login-model-class-diagram.puml) |
| 1.5 | Google Login | `User`, `OAuthAccount`, `AuthSession`, `UserProfile` | [PNG](1_5_google-login-model-class-diagram.png) · [PUML](1_5_google-login-model-class-diagram.puml) |
| 1.6 | Logout | `AuthSession`, `User`, `UserProfile` | [PNG](1_6_logout-model-class-diagram.png) · [PUML](1_6_logout-model-class-diagram.puml) |
| 1.7 | Get Current User | `User`, `UserProfile` | [PNG](1_7_get-current-user-model-class-diagram.png) · [PUML](1_7_get-current-user-model-class-diagram.puml) |
| 1.8 | Forgot Password | `User`, `PasswordResetToken` | [PNG](1_8_forgot-password-model-class-diagram.png) · [PUML](1_8_forgot-password-model-class-diagram.puml) |
| 1.9 | Reset Password | `PasswordResetToken`, `User`, `AuthSession` | [PNG](1_9_reset-password-model-class-diagram.png) · [PUML](1_9_reset-password-model-class-diagram.puml) |
| 1.10 | View Profile | `User`, `UserProfile` | [PNG](1_10_view-profile-model-class-diagram.png) · [PUML](1_10_view-profile-model-class-diagram.puml) |
| 1.11 | Update Profile | `User`, `UserProfile` | [PNG](1_11_update-profile-model-class-diagram.png) · [PUML](1_11_update-profile-model-class-diagram.puml) |
| 1.12 | Upload Avatar | `User`, `UserProfile` | [PNG](1_12_upload-avatar-model-class-diagram.png) · [PUML](1_12_upload-avatar-model-class-diagram.puml) |
| 1.13 | Change Password | `User` | [PNG](1_13_change-password-model-class-diagram.png) · [PUML](1_13_change-password-model-class-diagram.puml) |
