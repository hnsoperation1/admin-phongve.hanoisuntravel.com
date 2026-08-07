# Brief: Có nên chuyển (một phần) sang Railway không?

## Đã chốt (2026-08-06): Phương án B

Tách riêng worker gửi tin sang service Node độc lập (`worker/`, deploy
Railway), giữ nguyên UI/dashboard Next.js trên Vercel — chọn B thay vì A
vì worker crash/lỗi session Zalo không được phép kéo theo UI. Code đã
implement, xem "Trạng thái sau khi implement Phương án B" cuối file.

---

Phần dưới đây là brief gốc, giữ lại để tham khảo bối cảnh quyết định.

## Vấn đề đang gặp

`zca-js` (client Zalo cá nhân, xem `BRIEF-zalo-auto-post.md`) cần 1 process
sống liên tục để giữ session/socket. Vercel serverless function chết sau
vài giây → không giữ được. App hiện tại (`admin-phongve.hanoisuntravel.com`,
Next.js, deploy Vercel) né vấn đề này bằng cách:

- `src/lib/zalo.ts` — cache `Promise<API>` ở module scope, chỉ tồn tại
  trong đời 1 lần cold start (không phải sống mãi).
- `vercel.json` — Vercel Cron gọi `GET /api/cron/run-scheduled` mỗi phút
  (`* * * * *`, cần gói **Vercel Pro** mới cho phép lịch dưới 1 ngày).
- Route đó (`src/app/api/cron/run-scheduled/route.ts`) tự query bảng
  `zalo_scheduled_messages` (Supabase) lấy job `status='pending' AND
  run_at <= now()`, gọi `sendZaloGroupMessage()` (login lại từ
  `ZALO_SESSION_CREDENTIALS` nếu cache rỗng — tức là gần như mỗi lần cold
  start đều login lại), rồi cập nhật trạng thái.

**Hệ quả của cách né này**: login lại nhiều lần hơn cần thiết (mỗi cold
start), tốn Vercel Pro chỉ để có cron phút, và không có listener sống thật
(chưa dùng nhưng có thể cần sau này, vd nghe phản hồi trong nhóm).

## Vì sao Railway được nhắc tới

Railway chạy service dạng long-running process thật (khác serverless) —
có thể login 1 lần lúc service khởi động, giữ session trong RAM, tự poll
`zalo_scheduled_messages` bằng `setInterval` nội bộ thay vì cron HTTP. Phù
hợp hơn hẳn với bản chất của `zca-js` (đúng như brief gốc đã cảnh báo "Không
dùng Vercel/serverless" — nhưng lúc build code sau đó lại build trên
Vercel, có mâu thuẫn thật giữa 2 quyết định, cần rà lại).

## Đã xác nhận — không phải rào cản

**SSO với `hns-crm` không bị ảnh hưởng khi đổi platform.** SSO dựa vào
cookie Supabase Auth chung domain `.hanoisuntravel.com` (xem
`src/contexts/auth.tsx` dòng 15-17: "Không có route /login riêng — session
đến từ SSO với CRM (cookie chung domain .hanoisuntravel.com)"), KHÔNG phụ
thuộc app chạy trên Vercel hay Railway. Chỉ cần trỏ DNS subdomain
`admin-phongve.hanoisuntravel.com` sang Railway là được, cookie vẫn hoạt
động bình thường.

## Câu hỏi chưa chốt — cần quyết định ở session tiếp theo

**Chuyển cả app hay chỉ tách phần worker?**

- **Phương án A — chuyển toàn bộ app sang Railway**: đơn giản, 1 chỗ
  deploy, Next.js UI + cron worker cùng chạy 1 nơi. Railway hỗ trợ host
  Next.js bình thường (standalone output).
- **Phương án B — chỉ tách worker gửi tin sang Railway, giữ UI/dashboard
  trên Vercel**: UI (CRUD lịch gửi tin, `src/app/lich-gui-tin/page.tsx`)
  vẫn ở Vercel như hiện tại; tạo 1 service Node riêng (hoặc project Railway
  riêng) chỉ chứa logic trong `src/lib/zalo.ts` + vòng lặp poll
  `zalo_scheduled_messages`, không có Next.js/UI gì cả. 2 service cùng đọc
  chung 1 bảng Supabase nên không cần API nội bộ giữa 2 bên.

Cần cân nhắc: A đơn giản vận hành hơn nhưng phải kiểm tra Next.js chạy
trên Railway có gì khác biệt cần lưu ý (build command, biến môi trường,
health check...). B giữ nguyên phần đã chạy ổn (UI) không đụng vào, chỉ
thay đúng phần đang có vấn đề, nhưng thêm 1 chỗ deploy/theo dõi riêng.

## Trạng thái code tới thời điểm viết brief này (2026-08-06)

- Code scaffold đầy đủ (auth, SSO, gate quyền, CRUD API, cron route, UI),
  `npx tsc --noEmit` sạch.
- **Chưa deploy lần đầu** lên bất kỳ platform nào (Vercel hay Railway đều
  chưa) — vẫn còn nguyên cơ hội chọn platform mà không phải migrate ngược.
- **Chưa chạy** migration `migration_zalo_scheduled_messages.sql` trên
  Supabase SQL Editor.
- **Chưa có** `ZALO_SESSION_CREDENTIALS` thật (chưa có script tự động lấy
  — phải tự chạy `loginQR()` 1 lần ngoài serverless để lấy `Credentials`
  JSON, xem hướng dẫn bước 3 trong `BRIEF-zalo-auto-post.md`).

## Trạng thái sau khi implement Phương án B

Code đã có: thư mục `worker/` (service Node riêng, `package.json` +
`index.js` login lúc khởi động + `setInterval` poll `zalo_scheduled_messages`
mỗi ~20s, README hướng dẫn deploy Railway). Đã gỡ khỏi app Next.js chính:
route `/api/cron/run-scheduled`, `vercel.json` (cron), `src/lib/zalo.ts`,
dep `zca-js` — UI/API CRUD lịch gửi tin (`src/app/lich-gui-tin/`,
`src/app/api/lich-gui-tin/`) giữ nguyên, không đổi gì.

## Cập nhật (2026-08-06, cùng ngày): bỏ hẳn `ZALO_SESSION_CREDENTIALS` env — chuyển sang QR-login qua web

Ban đầu định lấy `ZALO_SESSION_CREDENTIALS` bằng script CLI chạy tay
(`worker/get-credentials.js`), dán thủ công vào env Railway. Sau khi bàn
lại, đổi sang cách gọn hơn — **không cần đụng env Railway nữa**:

- Bảng mới `zalo_session` (Supabase, xem
  `hns-crm/supabase/migrations/migration_zalo_session.sql`) — 1 dòng duy
  nhất, lưu `status` + `qr_image` (base64) + `credentials` (JSONB, nhạy
  cảm — không bao giờ trả về browser).
- Trang mới `src/app/zalo-session/page.tsx` ("Đăng nhập lại Zalo" trong
  Sidebar) — bấm nút → API `POST /api/zalo-session` ghi `status='requested'`.
- `worker/index.js` giờ có 2 vòng poll song song: gửi job đến hạn (mỗi
  20s) VÀ kiểm tra `zalo_session` (mỗi 4s). Thấy `status='requested'` thì
  tự gọi `loginQR()`, ghi ảnh QR lên Supabase để web hiển thị, quét xong
  tự ghi credentials mới vào Supabase **và tự áp dụng ngay** (không cần
  restart worker).
- Lúc worker khởi động, tự đọc `credentials` mới nhất từ Supabase thay vì
  đọc env — nếu chưa có, worker vẫn chạy bình thường (chỉ chưa gửi được
  tin), chờ ai đó vào web bấm đăng nhập.

Railway giờ chỉ cần đúng 2 env cố định (`NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`) — set 1 lần lúc setup, không bao giờ phải
sửa lại vì lý do session Zalo nữa.

## Cập nhật (2026-08-07): đồng bộ danh sách nhóm Zalo thật vào form "Thêm lịch gửi tin"

Trước đó form "Thêm lịch gửi tin" phải gõ tay Thread ID nhóm. Giờ
`worker/index.js` có thêm `syncGroups()` — gọi `api.getAllGroups()` +
`api.getGroupInfo()` của zca-js (đã xác nhận API tồn tại, trả về `name`
thật của nhóm), upsert vào bảng mới `zalo_groups` (Supabase, xem
`migration_zalo_groups.sql`). Chạy định kỳ mỗi 5 phút
(`GROUP_SYNC_INTERVAL_MS`) + chạy ngay sau mỗi lần login/đăng nhập lại
thành công. Web đọc qua `GET /api/zalo-groups` (route mới, cùng
`requireKeToan()` như các route khác), form giờ hiện checklist nhóm thật
thay vì phải gõ tay — vẫn giữ nút "Thêm nhóm mới" làm phương án dự phòng
(nhóm vừa tạo, chưa kịp tới lượt đồng bộ tiếp theo).

## Cập nhật (2026-08-07, cùng ngày): đồng bộ thêm danh bạ bạn bè Zalo (chưa dùng để gửi tin)

Ngoài nhóm, `worker/index.js` giờ có thêm `syncContacts()` — gọi
`api.getAllFriends()` của zca-js, upsert vào bảng mới `zalo_contacts`
(Supabase, xem `migration_zalo_contacts.sql`), cùng nhịp chạy với
`syncGroups()` (định kỳ `CONTACT_SYNC_INTERVAL_MS` + ngay sau login).
**Chỉ dừng ở mức đồng bộ dữ liệu sẵn có** — CHƯA có route API/UI nào dùng
tới bảng này, vì lịch gửi tin hiện chỉ gửi vào nhóm (`ThreadType.Group`).
Muốn gửi cho cá nhân thì cần thêm việc khác (cột phân biệt loại người
nhận trên `zalo_scheduled_messages`, worker chọn đúng `ThreadType`, UI cho
chọn cả bạn bè lẫn nhóm) — chưa làm, làm sau nếu cần.

## Việc còn lại (chưa làm)

1. Chạy 4 migration trên Supabase SQL Editor:
   `migration_zalo_scheduled_messages.sql`, `migration_zalo_session.sql`,
   `migration_zalo_groups.sql`, `migration_zalo_contacts.sql`.
2. Deploy `worker/` lên Railway (Root Directory = `worker`), set 2 env
   Supabase — xem `worker/README.md`.
3. Deploy app Next.js chính lên Vercel (chưa deploy lần đầu) — không đổi
   gì so với kế hoạch cũ, DNS `admin-phongve.hanoisuntravel.com` vẫn trỏ
   Vercel như bình thường (SSO không phụ thuộc worker).
4. Vào trang "Đăng nhập lại Zalo" trên web, bấm nút, quét QR bằng acc Zalo
   phụ — lấy session Zalo thật lần đầu tiên (worker sẽ tự đồng bộ danh
   sách nhóm ngay sau đó).
5. Test gửi tin thật vào 1 nhóm Zalo + test SSO thật giữa 2 domain trên
   trình duyệt (chưa test qua bao giờ, mới chỉ đúng logic + tsc sạch).
