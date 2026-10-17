# SECURITY & TRUST MODEL

## Ranh giới tin cậy

- Client không đáng tin. Server tự tính sát thương, va chạm, tầm nhìn, kinh tế, thời gian bom. Input bị kẹp: yaw/pitch ±1.55 rad, nút 16-bit, `grenadeSlot` 0..3, `viewTick` trong cửa sổ lag comp.
- Bot chỉ thấy `BotSensorView`; ESLint chặn import mô phỏng. Đây là biện pháp kiến trúc, không chỉ quy ước.
- Snapshot bị lọc PVS để client không nhận vị trí địch sau tường; sự kiện âm thanh lọc theo bán kính.

## Xác thực

- Mật khẩu: scrypt N=16384, r=8, p=1, salt 16 B, so sánh constant-time.
- Access token: JWT HS256, 15 phút, có `jti`; logout thêm jti vào danh sách thu hồi trong RAM (mất khi restart — production nên chuyển sang Redis).
- Refresh token: 32 B ngẫu nhiên, lưu SHA-256, xoay vòng theo family; dùng lại token đã thu hồi → thu hồi toàn family.
- Giới hạn đăng nhập theo IP+username 12/phút; API 240 request/phút/IP (Redis INCR, fallback bộ nhớ).
- JWT secret mặc định chỉ cho dev; production từ chối secret `dev-only`.

## Sổ cái & chợ

- Mọi thay đổi Credits đi qua `ledger_transactions` + `ledger_entries`; trigger cấm UPDATE/DELETE.
- Tổng bút toán = 0; tài khoản người dùng không âm; khóa hàng theo thứ tự id.
- Chợ khóa listing trước khi khóa tài khoản, kiểm tra lại idempotency sau khóa; unique `(buyer_id, idem_key)`.
- Store/chợ bắt buộc idempotency key; không tin giá từ client (giá dịch vụ lấy từ DB/JSON, giá chợ kiểm min/max).
- Audit log ghi hành động mua/bán/đăng bán/đăng nhập.

## Vận hành

- Secrets chỉ qua env/secret manager, không commit; `.env` bị ignore.
- Header bảo mật: nosniff, frame DENY, referrer no-referrer, permissions-policy tắt mic/camera.
- CORS theo allowlist (localhost + preview E2B + PUBLIC_ORIGIN), kiểm cả upgrade WebSocket.
- Giới hạn `maxPayload` 4 KB, rate limit tin nhắn, chat 120 ký tự đã lọc ký tự điều khiển.
- Prometheus không lộ dữ liệu cá nhân; pino redact authorization/password/token.
- Docker: container chạy user không phải root (xem Dockerfile), Postgres/Redis chỉ trong network nội bộ.
- Chưa có WAF/DDoS protection, chưa có audit định kỳ, chưa có mã hoá at-rest cho Postgres ngoài mặc định của hạ tầng.

## Báo cáo lỗ hổng

Gửi email bảo mật của dự án (chưa cấu hình trong repo). Không mở issue công khai cho lỗ hổng đang hoạt động.

## Giới hạn đã biết

- Danh sách thu hồi access token trong RAM → restart server làm token cũ dùng lại được đến khi hết hạn 15 phút.
- Rate limit gameserver dựa trên socket; kẻ tấn công mở nhiều kết nối vẫn tốn tài nguyên. Cần proxy/WAF ở production.
- Chưa có kiểm thử xâm nhập, chưa chạy Postgres/Redis thật trong sandbox → các đường SQL chưa được chứng minh bằng test tích hợp.
