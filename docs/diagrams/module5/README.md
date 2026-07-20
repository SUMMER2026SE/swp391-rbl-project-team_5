# State Diagrams – Module 5 (Partner Management, phần của Lộc)

Ảnh render từ source Mermaid. Mỗi sơ đồ có 3 file: `.mmd` (nguồn), `.png`, `.svg`.
Render bằng `@mermaid-js/mermaid-cli` (scale ×3). Nội dung + đối chiếu code: xem
[`../../state-diagrams-module5.md`](../../state-diagrams-module5.md).

| # | File | Nội dung |
|---|---|---|
| B1 | `B1_PartnerProfile` | Vòng đời hồ sơ đối tác (PENDING→APPROVED/REJECTED/SUSPENDED) |
| B2 | `B2_Attraction_status` | Máy trạng thái kiểm duyệt của Attraction (`status`) |
| B3 | `B3_Attraction_publication` | Máy trạng thái phát hành (`publicationStatus`) |
| B2b | `B2b_Attraction_orthogonal` | Bản gộp orthogonal 2 vùng đồng thời (chuẩn UML) |
| B4 | `B4_TicketProduct` | Gói vé: ACTIVE↔INACTIVE→Archived |
| B5 | `B5_StaffAttractionAssignment` | Phân công nhân viên: Active↔Revoked |
| B6 | `B6_AttractionImage` | Ảnh: Primary/Secondary→Deleted |
| B7 | `B7_TimeSlot_SpecialDate` | Khung giờ (`isActive`) & ngày đặc biệt (`closed`) |

## Render lại sau khi sửa `.mmd`

```bash
cd docs/diagrams/module5
CFG=../../../<đường-dẫn>/puppeteer-config.json   # trỏ executablePath tới chrome.exe
npx -y @mermaid-js/mermaid-cli -i B1_PartnerProfile.mmd -o B1_PartnerProfile.png -p "$CFG" -b white -s 3
```
