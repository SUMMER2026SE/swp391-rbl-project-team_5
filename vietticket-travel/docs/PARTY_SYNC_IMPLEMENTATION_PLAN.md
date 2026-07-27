# VietTicket PartySync — kế hoạch triển khai end-to-end

## 1. Bài toán khách hàng

VietTicket hiện hỗ trợ một khách hàng tự tìm điểm, tạo lịch trình, đặt vé và bật
Live Trip. Khoảng trống còn lại nằm trước bước đặt vé: một nhóm bạn hoặc gia đình
thường phải gửi link qua ứng dụng chat, hỏi ngân sách từng người và thống nhất thủ
công trước khi một người đứng ra đặt.

PartySync giải quyết đúng khoảng trống đó:

1. Một khách hàng đã đăng nhập tạo phòng theo thành phố, ngày đi, số người và ngân
   sách vé của cả nhóm.
2. Bạn đồng hành quét QR hoặc mở link mời, nhập tên hiển thị và tham gia mà không
   phải tạo tài khoản.
3. Mọi người bình chọn các điểm lấy từ catalog đang bán thật.
4. Backend tạo phương án đồng thuận, kiểm tra lại tình trạng bán vé, sức chứa,
   khung giờ, cơ cấu người lớn/trẻ em và ngân sách.
5. Host khóa phương án, lưu lịch trình vào tài khoản và tiếp tục quy trình booking
   hiện hữu. Host là người thanh toán và sở hữu booking.

## 2. Phạm vi MVP

### Bao gồm

- Host là CUSTOMER đã đăng nhập.
- Tạo tối đa một phòng mở trên mỗi yêu cầu; phòng có 2–10 thành viên.
- Link/QR mời chứa token ngẫu nhiên, lưu hash ở database và có thời hạn.
- Guest session là token ngẫu nhiên có phạm vi đúng một phòng, có thời hạn và có
  thể bị Host thu hồi.
- Host và guest đều có thể đặt ngân sách tham khảo, chọn nhóm sở thích và bình chọn
  `LOVE`, `LIKE`, `VETO`.
- Presence, thành viên mới, thay đổi preference/vote, khóa/mở lại phòng được phát
  qua Socket.IO; REST response vẫn là nguồn sự thật.
- Smart Consensus Engine chạy deterministic trên snapshot có version.
- Lịch trình cuối chỉ chứa attraction ID từ candidate của phòng và catalog công
  khai; tồn vé được kiểm tra lại tại thời điểm chốt.
- Host có thể lưu booking queue hiện hữu, sau đó đặt từng dòng vé theo transaction
  và chính sách của từng Partner.
- Host có thể bật Live Trip từ lịch trình đã chốt.
- Có lịch sử decision để giải thích thuật toán và phục vụ audit.

### Không bao gồm

- Split payment, ví nhóm hoặc chia hoàn tiền.
- Group chat tổng quát.
- Guest truy cập booking, thanh toán, support hoặc dữ liệu tài khoản Host.
- Tự giữ toàn bộ vé của nhiều Partner trong một transaction.
- Tự thay đổi booking đã thanh toán.
- LLM tự tạo attraction, giá, tồn vé hoặc kết quả bình chọn.

## 3. Quy tắc nghiệp vụ

1. Phòng chỉ được tạo cho ngày bắt đầu từ ngày mai, từ 1–5 ngày, 1–20 người và
   ngân sách vé hợp lệ.
2. Phòng `OPEN` mới nhận thành viên, preference và vote.
3. `FINALIZED` là snapshot bất biến. Muốn thay đổi phải mở lại; decision cũ được
   giữ và version phòng tăng.
4. Cần tối thiểu hai thành viên đang hoạt động và hai thành viên đã vote mới được
   chốt.
5. Một `VETO` loại attraction khỏi lần chốt hiện tại. UI phải giải thích đây là
   quyền phủ quyết, không phải dislike thông thường.
6. Mỗi thành viên chỉ có một vote trên một candidate; ghi đè vote phải idempotent.
7. Candidate phải tiếp tục công khai, đang vận hành, Partner được duyệt và có vé
   phù hợp cho ngày được xếp.
8. Người lớn không được dùng vé trẻ em. Trẻ em chỉ fallback sang vé người lớn khi
   không có vé trẻ em phù hợp và UI phải cảnh báo.
9. Tổng giá là giá vé cho toàn nhóm; không bao gồm ăn uống và di chuyển.
10. Finalize dùng optimistic concurrency: nếu member/vote/preference thay đổi lúc
    thuật toán đang chạy thì không lưu kết quả cũ.
11. Invite hết hạn không làm mất member đã tham gia; Guest session hết hạn hoặc bị
    remove thì không còn đọc/vote được.
12. Host không thể tự remove mình. Guest không thể thao tác quản trị phòng.

## 4. Consensus Engine

Mỗi candidate có utility:

```text
0.45 * average_member_satisfaction
+ 0.25 * minimum_member_satisfaction
+ 0.15 * budget_comfort_ratio
+ 0.10 * normalized_rating
+ 0.05 * preference_match
```

`LOVE = 1.0`, `LIKE = 0.7`, chưa vote = `0.35`, `VETO` loại candidate.
Từ `PARTY_CONSENSUS_V2`, một địa điểm chỉ được đưa vào allowlist lập lịch khi có ít
nhất một phiếu `LOVE/LIKE` và không có `VETO`; địa điểm chưa ai ủng hộ không được tự
chèn chỉ để lấp đầy ngày.

Host chỉ có thể chốt khi ít nhất 60% thành viên hoạt động đã vote, làm tròn lên và
không thấp hơn hai người. Nếu đã đủ quorum nhưng chưa đủ 100%, UI yêu cầu Host xác nhận
rõ trước khi tiếp tục.

Engine chọn một allowlist giới hạn theo số ngày và nhịp độ, sau đó dùng planner
nghiệp vụ hiện hữu để xếp ngày/khung giờ và tạo đúng ticket line. Điểm đồng thuận
cuối được tính lại trên các attraction thực sự xuất hiện trong plan, không dựa
trên candidate đã bị planner loại.

Kết quả phải trả:

- consensus score;
- average/minimum satisfaction;
- số thành viên thoải mái với chi phí mỗi người;
- candidate bị veto;
- candidate bị loại vì không còn vé/ngân sách/lịch;
- algorithm version và catalog checked time.

## 5. Data model

- `PartyRoom`: Host, tiêu chí chuyến đi, invite hash, status, version, saved plan.
- `PartyMember`: Host/Guest, tên, avatar, preference, budget, scoped session hash.
- `PartyCandidate`: attraction ID và snapshot chỉ dùng hiển thị.
- `PartyVote`: unique theo member + candidate.
- `PartyDecision`: snapshot plan, metrics, algorithm version và input version.

## 6. API

### Host authenticated

- `POST /api/party/rooms`
- `GET /api/party/rooms`
- `POST /api/party/rooms/:roomId/finalize`
- `POST /api/party/rooms/:roomId/reopen`
- `POST /api/party/rooms/:roomId/invite/rotate`
- `DELETE /api/party/rooms/:roomId/members/:memberId`
- `POST /api/party/rooms/:roomId/close`

### Host hoặc scoped guest

- `GET /api/party/rooms/:roomId/session`
- `PATCH /api/party/rooms/:roomId/me`
- `PUT /api/party/rooms/:roomId/candidates/:candidateId/vote`
- `DELETE /api/party/rooms/:roomId/candidates/:candidateId/vote`

### Public join có rate limit

- `POST /api/party/rooms/:roomId/invite/preview`
- `POST /api/party/rooms/:roomId/join`

## 7. Realtime

- `JOIN_PARTY_ROOM`
- `LEAVE_PARTY_ROOM`
- `PARTY_MEMBER_JOINED`
- `PARTY_MEMBER_UPDATED`
- `PARTY_VOTE_UPDATED`
- `PARTY_ROOM_UPDATED`
- `PARTY_PLAN_FINALIZED`
- `PARTY_ACCESS_REVOKED`

Socket chỉ phát hint nhỏ gồm `roomId`, `reason`, `version`; client tải lại REST
snapshot chính thức. Guest socket chỉ được vào room gắn trong scoped session.

## 8. Definition of Done

- Migration và Prisma validation thành công.
- Unit test consensus, opaque token, validation, payload privacy và fixed-time ticket scheduling.
- E2E API/UI kiểm tra ownership, guest scope, join/vote/finalize/reopen/remove/close.
- E2E kiểm tra preview lời mời an toàn, quorum 60%, chỉ chọn candidate được ủng hộ,
  phòng quá ngày tự chuyển `EXPIRED` và dashboard tách hoạt động/lịch sử.
- E2E kiểm tra guest không thể dùng scoped token để đọc danh sách phòng hoặc chốt lịch.
- Frontend test helper lưu scoped guest session theo từng phòng.
- Lint, frontend test/build và backend test xanh.
- Demo thật bằng ít nhất hai browser context hoặc một desktop + một mobile viewport:
  join QR, vote realtime, xoay link mời, finalize, booking queue, reopen, thu hồi guest và close.
- Rà UX responsive, empty/error/loading state, keyboard focus và contrast.
- Không tuyên bố giữ vé, AI accuracy hoặc split payment ngoài khả năng thực tế.

## 9. Kịch bản trình diễn bảo vệ

1. Đăng nhập tài khoản CUSTOMER trên laptop và mở `/party`.
2. Tạo phòng cho ngày còn vé, ngân sách và số khách thực tế.
3. Chiếu QR; một thành viên quét bằng điện thoại, kiểm tra đúng tên chuyến, Host, ngày đi,
   sau đó nhập tên và tham gia mà không cần đăng nhập.
4. Hai màn hình bình chọn đồng thời để hội đồng thấy số phiếu cập nhật realtime.
5. Cố tình dùng một `VETO` để giải thích quyền phủ quyết, sau đó đổi sang lựa chọn đồng thuận.
6. Host chốt lịch; trình bày điểm đồng thuận, mức hài lòng thấp nhất, chi phí/người,
   thời điểm kiểm tra catalog và lịch có khung giờ vé thật.
7. Bấm tiếp tục đặt vé để chứng minh PartySync nối vào booking queue hiện có, không phải demo tách rời.
8. Quay lại, mở bình chọn, thu hồi một guest rồi đóng phòng để chứng minh đủ vòng đời và kiểm soát truy cập.

Tài khoản dữ liệu demo cục bộ:

- Email: `minh.anh.nguyen@vietticket.local`
- Mật khẩu: `Demo@VietTicket2026`

Khách trên điện thoại không cần đăng nhập; guest token chỉ có quyền trong đúng phòng đã quét,
được lưu dạng hash ở server và bị vô hiệu ngay khi Host thu hồi.

## 10. Kết quả nghiệm thu thực tế

- Migration `20260724160000_add_party_sync` đã được áp dụng lên database demo.
- Browser E2E đã chạy bằng một desktop context cho Host và một mobile viewport cho Guest.
- Luồng đã xác nhận: tạo phòng HTTP 201, QR hiển thị, preview đúng chuyến đi, guest join
  không tài khoản, realtime, quorum 60%, token mời cũ vô hiệu sau rotate, guest bị chặn khỏi API Host, chốt lịch,
  lịch được chuyển sang booking queue, reopen, remove/revoke và close.
- Planner đã được sửa để tôn trọng vé có giờ cố định như `16:30`, đồng thời không tự chèn
  địa điểm ngoài candidate allowlist chỉ để lấp đầy lịch.
- Payload chia sẻ không lộ UUID tài khoản Host/Guest; vote của thành viên đã bị thu hồi không
  còn tham gia bộ đếm hay kết quả đồng thuận.
- Join chạy trong transaction `SERIALIZABLE` với retry giới hạn để không vượt sức chứa khi
  nhiều điện thoại quét cùng lúc; khách bị xóa nhầm có thể tham gia lại bằng tên cũ nhưng
  member/vote cũ vẫn được giữ cho audit.
- Dashboard tách phòng hoạt động và lịch sử; phòng có ngày đi đã qua tự chuyển `EXPIRED`
  và không thể join, vote, đổi QR hoặc chốt lại.
- Mobile audit xác nhận menu đóng có chiều cao 0, trang join không tràn ngang và không
  tự cuộn qua phần thông tin lời mời.
