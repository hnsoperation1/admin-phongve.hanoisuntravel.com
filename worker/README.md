# zalo-worker

Service Node riêng, tách khỏi app Next.js (`admin-phongve.hanoisuntravel.com`
— vẫn ở Vercel, không đổi gì). Chỉ làm 2 việc, cả 2 đều tự poll Supabase
(không mở port, không cần route HTTP nào gọi vào worker):

1. Poll `zalo_scheduled_messages` mỗi `POLL_INTERVAL_MS` (mặc định 20s) —
   gửi job đến hạn.
2. Poll `zalo_session` mỗi `LOGIN_CHECK_INTERVAL_MS` (mặc định 4s) — nếu
   thấy `status='requested'` (ai đó vừa bấm "Đăng nhập lại Zalo" trên
   web), tự quét QR, ghi ảnh QR + session mới vào Supabase.

Xem `../BRIEF-railway-vs-vercel.md` để biết lý do tách worker (Phương án B).

## Lấy session Zalo lần đầu / khi hết hạn

**Không cần chạy script gì trên máy.** Vào app web (`admin-phongve`,
trang "Đăng nhập lại Zalo" trong Sidebar) → bấm nút → ảnh QR hiện ngay
trên web → quét bằng **acc Zalo phụ** (xem `BRIEF-zalo-auto-post.md`) →
worker tự lưu session mới vào Supabase và dùng ngay, không cần restart
Railway.

Điều kiện: worker phải đang chạy (local hoặc đã deploy Railway) thì mới
có ai đó poll thấy yêu cầu và xử lý — nếu worker chưa chạy lần nào, chạy
`npm start` trước đã.

## Chạy local

```
cd worker
npm install
cp .env.example .env   # điền NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm start
```

## Deploy Railway

1. New Project → Deploy from GitHub repo → chọn repo, **Root Directory =
   `worker`** (monorepo, Railway chỉ build/deploy thư mục này).
2. Không cần expose HTTP/public domain — đây là background worker thuần,
   không bind port nào cả.
3. Set env (Settings → Variables): `NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, tuỳ chọn `POLL_INTERVAL_MS` /
   `LOGIN_CHECK_INTERVAL_MS`.
4. Railway tự nhận Node project qua Nixpacks (đọc `package.json`), build =
   `npm install`, start = `npm start` (không cần Dockerfile).
5. Xem log: lần đầu deploy sẽ thấy "Chưa có session Zalo nào được lưu" —
   bình thường, vào web bấm đăng nhập lại như hướng dẫn trên.

## Lưu ý vận hành

- Nếu session Zalo hết hạn, job sẽ liên tục bị đánh dấu `status='error'`
  (worker không tự retry để tránh spam nhóm) — vào web bấm "Đăng nhập lại
  Zalo", quét QR xong worker tự áp dụng session mới ngay (không cần
  restart). Sau đó vào trang lịch gửi tin đổi các job lỗi về lại
  `pending`.
- 1 phiên đăng nhập = 1 listener sống. Không mở Zalo Web bằng trình duyệt
  thật song song — sẽ tự ngắt phiên của worker.
- QR do zca-js tự hết hạn sau ~100 giây nếu không quét kịp — bấm lại nút
  "Đăng nhập lại Zalo" trên web để lấy QR mới.
