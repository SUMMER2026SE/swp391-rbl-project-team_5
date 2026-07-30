# SePay webhook setup

VietTicket supports automatic VietQR confirmation through a signed SePay
webhook. Keep the existing two-Admin maker-checker screen as the exception
queue; a valid, exact webhook payment does not require either Admin.

## Environment separation

| Environment | SePay mode | Webhook target | Data |
| --- | --- | --- | --- |
| Local development | Test Mode | Public HTTPS tunnel to port 5000 | Local PostgreSQL |
| Online defense/demo | Test Mode | Staging Render URL | Staging/demo PostgreSQL |
| Production | Live | Production backend URL | Production PostgreSQL |

Use a different HMAC secret in every environment. Never point Test Mode at the
production database, and never run demo seed/reset commands against production.

## Backend configuration

Add these values to the environment of the backend receiving the callback:

```env
SEPAY_WEBHOOK_ENABLED=true
SEPAY_WEBHOOK_SECRET="<HMAC secret created in SePay>"
SEPAY_WEBHOOK_TOLERANCE_SECONDS=300
```

The receiving bank configuration must match the account connected to SePay:

```env
BANK_BIN="<six-digit bank BIN>"
BANK_ACCOUNT_NUMBER="<receiving account number>"
BANK_ACCOUNT_NAME="<receiving account owner>"
```

Do not send the secret through chat, email, screenshots, Git, or issue
trackers. Store it only in local `.env` or the deployment platform's encrypted
environment settings.

## Create the SePay webhook

Open **Dashboard → Tích hợp → Webhooks → Thêm webhook**.

1. **Cơ bản**
   - Tên: `VietTicket Local`, `VietTicket Staging`, or `VietTicket Production`
   - URL: `https://<public-backend>/api/payments/sepay/webhook`
   - Loại giao dịch: `Tiền vào`
   - Định dạng: `JSON`
   - Tự động gửi lại: enabled
2. **Tài khoản**
   - Select the same receiving account configured by
     `BANK_ACCOUNT_NUMBER`.
   - Use payment-code prefix `VT` and ignore transactions without a payment
     code after the SePay payment-code structure has been configured.
3. **Bảo mật**
   - Select `HMAC-SHA256`.
   - Generate a random Secret Key.
   - Copy it immediately into `SEPAY_WEBHOOK_SECRET` for that environment.
4. **Cảnh báo**
   - Enable failure alerts if a channel is available.

The production URL must use HTTPS. `localhost` cannot receive a callback from
SePay. For local development, expose `http://localhost:5000` through a
temporary HTTPS tunnel and use the tunnel hostname in the webhook URL.

## Safe verification sequence

1. Apply migrations and restart the backend.
2. Open the backend health endpoint.
3. In SePay, use **Gửi thử**. VietTicket verifies the HMAC and returns
   `{"success":true}` without creating a payment for SePay's sample event.
4. In SePay Test Mode, create a simulated incoming transfer whose amount and
   `VT...` content exactly match a pending VietTicket booking.
5. Confirm that the bank-transfer page redirects to the e-ticket and that only
   one payment/ticket set exists after replaying the webhook.
6. Test wrong amount and wrong content. Neither case may issue a ticket; it
   must remain available for manual review.

## Processing guarantees

- The HMAC is calculated over SePay's exact raw body and timestamp.
- Requests outside the configured timestamp window are rejected.
- Provider event IDs are unique and safe against concurrent retry/replay.
- The receiving account, booking suffix, payment method, and exact integer VND
  amount must all match.
- Ticket creation and payment capture reuse VietTicket's existing serializable
  transaction and idempotent bank-payment key.
- Late payments never issue a ticket; they enter the mandatory 100% refund
  workflow.
