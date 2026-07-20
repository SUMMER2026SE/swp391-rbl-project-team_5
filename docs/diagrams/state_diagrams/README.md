# State Diagrams — modules 3.6 / 3.7 / 3.8 / 3.9

State diagram (biểu đồ trạng thái) mô tả **vòng đời trạng thái của từng thực thể** mà các module
3.6 Attraction Partner Management, 3.7 Customer Support, 3.8 Staff Operations, 3.9 Admin Back-Office
điều khiển. Trạng thái & chuyển tiếp lấy **đúng theo enum trong Prisma** (`backend/prisma/schema.prisma`)
và logic controller thật — không suy đoán.

| Module | Thực thể | Enum / cờ | File |
|---|---|---|---|
| 3.6 | PartnerProfile | `PartnerStatus` (PENDING/APPROVED/REJECTED/SUSPENDED) | `sd_36_partner_profile` |
| 3.6 | Attraction | `AttractionStatus` (DRAFT/PENDING/APPROVED/REJECTED/SUSPENDED) | `sd_36_attraction` |
| 3.6 | Attraction Publication | `AttractionPublicationStatus` (PAUSED/ACTIVE/ARCHIVED) | `sd_36_attraction_publication` |
| 3.6 | Ticket Product | `TicketStatus` (ACTIVE/INACTIVE) + archivedAt | `sd_36_ticket_product` |
| 3.7 | Support Ticket | `SupportStatus` (OPEN/IN_PROGRESS/RESOLVED) | `sd_37_support_ticket` |
| 3.8 | E-Ticket (TicketInstance) | `TicketInstanceStatus` (VALID/USED/EXPIRED/REFUNDED) | `sd_38_ticket_instance` |
| 3.8 | Refund Request | `RefundStatus` (PENDING/PROCESSING/APPROVED/REJECTED) | `sd_38_refund_request` |
| 3.9 | User Account | `UserStatus` (ACTIVE/LOCKED) | `sd_39_user_account` |
| 3.9 | Category | `isActive` (ACTIVE/HIDDEN) + delete | `sd_39_category` |
| 3.9 | Review | `isHidden` (VISIBLE/HIDDEN) | `sd_39_review` |

Ghi chú: PartnerProfile và Attraction có transition do **cả Partner lẫn Admin** kích hoạt — Admin
(mục 3.9.3 KYC Approval, 3.9.4 Attraction Approval, 3.9.8 Violation) duyệt/ẩn, Partner (mục 3.6) tạo/sửa/gửi lại.

Render lại: `hex=$(xxd -p FILE.puml | tr -d '\n'); curl -s -o FILE.png "https://www.plantuml.com/plantuml/png/~h$hex"`
