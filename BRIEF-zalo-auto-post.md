# Brief: Tự động đăng tin vào Zalo group (từ tài khoản Zalo cá nhân)

## Mục tiêu
Tự động (hoặc bán tự động) đăng tin nhắn vào một Zalo group, dùng tài khoản Zalo **cá nhân** (không phải Zalo OA, không phải Mini App).

## Cảnh báo quan trọng
- Zalo **không có API chính thức** cho tài khoản cá nhân. Cách làm dưới đây dùng thư viện **unofficial/reverse-engineered** (`zca-js`), giả lập hành vi của Zalo Web.
- Vi phạm điều khoản sử dụng của Zalo → **rủi ro bị khóa/khóa acc**. Rủi ro này đã được chấp nhận.
- Khuyến nghị: dùng **acc phụ**, không dùng acc chính.

## Kiến trúc & lựa chọn
- **Thư viện**: [`zca-js`](https://github.com/RFS-ADRENO/zca-js) (npm) — đăng nhập qua quét QR, có `listener` để nghe tin nhắn và `sendMessage` để gửi.
- **Không dùng Vercel/serverless**: `zca-js` cần một process sống liên tục để giữ session + socket. Vercel function chết sau vài giây nên không giữ được session.
- **Chạy trên**: PC cá nhân (Windows), dùng **PM2** để giữ process chạy nền + tự khởi động lại khi crash/reboot máy.
- **Cách kích hoạt đăng tin (trigger)**: **Chạy tay** — không có lịch, không tự động kích hoạt. Tự gõ lệnh mỗi khi muốn đăng. (Có thể nâng cấp lên cron hoặc trigger từ hệ thống sau này, code gửi tin vẫn tái sử dụng được.)

## Giảm rủi ro khóa acc
- Dùng acc phụ, không dùng acc chính
- Giới hạn tần suất gửi, tránh gửi hàng loạt liên tục / spam giống bot
- Tránh gửi lặp lại y hệt nội dung nhiều lần
- Không login song song nhiều nơi (dễ bị flag)
- Không mở Zalo Web bằng trình duyệt thật trong lúc bot đang chạy — chỉ 1 listener/phiên hoạt động cùng lúc, mở web sẽ tự ngắt phiên của bot

## Setup từng bước (Windows)

### 1. Cài Node.js
Tải bản LTS từ nodejs.org, cài đặt (Next → Next → Finish). Kiểm tra:
```
node -v
npm -v
```

### 2. Tạo project
```
mkdir zalo-bot
cd zalo-bot
npm init -y
npm install zca-js
```
Thêm `"type": "module"` vào `package.json` để dùng được cú pháp `import`.

### 3. Script đăng nhập — `login.js`
```js
import { Zalo } from "zca-js";

const zalo = new Zalo();
const api = await zalo.loginQR();

console.log("Đăng nhập thành công!");
```
Chạy `node login.js` → terminal hiện mã QR → mở app Zalo trên điện thoại (acc phụ) → quét mã (giống quét đăng nhập Zalo Web).

**Lưu session để khỏi quét QR mỗi lần chạy**: zca-js có hỗ trợ lưu lại cookie/imei để đăng nhập lại không cần QR — cú pháp chính xác tùy version hiện tại, xem phần "Login" trong docs chính thức: https://zca-js.tdung.com trước khi triển khai.

### 4. Lấy Group ID
Chưa có sẵn hàm liệt kê group ra ID trực quan. Cách dễ nhất: chạy listener, gửi thử 1 tin trong group cần nhắm tới, log `threadId` ra xem:
```js
import { Zalo, ThreadType } from "zca-js";

const zalo = new Zalo();
const api = await zalo.loginQR();

api.listener.on("message", (message) => {
    if (message.type === ThreadType.Group) {
        console.log("Group ID:", message.threadId, "| nội dung:", message.data.content);
    }
});
api.listener.start();
```

### 5. Script gửi tin — `post.js` (chạy tay)
```js
import { Zalo, ThreadType } from "zca-js";

const zalo = new Zalo();
const api = await zalo.loginQR(); // sau này thay bằng login từ session đã lưu

const GROUP_ID = "dán_threadId_ở_bước_4_vào_đây";

await api.sendMessage(
    { msg: "Nội dung tin cần đăng" },
    GROUP_ID,
    ThreadType.Group,
);

console.log("Đã gửi!");
```
Chạy `node post.js` mỗi khi muốn đăng — sửa nội dung trong file trước khi chạy.

### 6. PM2 (nếu cần chạy nền/listener liên tục)
```
npm install -g pm2
npm install -g pm2-windows-startup
pm2-startup install
```
(Trên Windows, `pm2 startup` gốc không hoạt động vì nhắm vào Linux/macOS — `pm2-windows-startup` tạo shortcut trong thư mục Startup của Windows để tự chạy `pm2 resurrect` khi đăng nhập máy.)

```
pm2 start login.js --name zalo-bot
pm2 save
```

## Việc còn cần làm khi triển khai
- Xác nhận cú pháp lưu/khôi phục session (cookie/imei) đúng version zca-js đang cài
- Lấy Group ID thật của nhóm cần đăng
- Quyết định có nâng cấp trigger (cron / event-driven) sau khi dùng "chạy tay" một thời gian hay không
