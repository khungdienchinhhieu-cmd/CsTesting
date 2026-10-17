# Kiến trúc TACTICAL STRIKE

## 1. Nguyên tắc

1. **Một mô phỏng, nhiều nơi chạy.** `packages/shared` là nguồn chân lý duy nhất cho di chuyển, va chạm, vũ khí, vòng đấu, bom, kinh tế. Offline worker, gameserver và test đều gọi cùng `MatchSim`/`SimHost`.
2. **Server quyết định.** Client chỉ gửi `InputCommand` (ý định); server xác thực, mô phỏng, bắn hitscan, trừ tiền, đặt bom. Client render từ snapshot.
3. **Bot không có quyền đọc mô phỏng.** Bot chỉ nhận `BotSensorView` đã lọc FOV/LOS/âm thanh và trả `BotCommand`. ESLint chặn import ngoài `@tactical/shared/bot-api`.
4. **Dữ liệu cân bằng nằm trong JSON**, không hard-code trong mã.

## 2. Luồng tick

```
InputCommand (client, seq) ──► MatchSim.submitInput()  (sanitize, buffer 12)
                                    │
server/worker: 64 Hz ──► SimHost.step() ──► MatchSim.step() ──► GameEvent[]
                                    │                  │
                          bot think 10 Hz      hitbox history 128 tick (lag comp)
                                    │
                snapshot 32 Hz ◄────┴── buildSnapshot() ──► encodeSnapshot() (bit-packed)
                                    │
client: decode ──► history buffer (interp 31ms) + prediction/reconciliation
```

- `viewTick` do client gửi bị kẹp trong `[tick-16, tick+1]`; server tua hitbox tối đa `MAX_LAG_COMP_MS=200`.
- Snapshot delta: protocol hỗ trợ base snapshot; server hiện gửi keyframe (base=null) để đơn giản và chống lỗi chuỗi; băng thông đo được ~65 kbps/người.
- Snapshot chỉ chứa đồng đội, bản thân, và địch trong PVS (FOV + LOS + “thấy trong 2 s”). Sự kiện âm thanh bị lọc theo bán kính.

## 3. Gói & phụ thuộc

```
shared ◄── bots
   ▲          ▲
   ├── gameserver (Fastify + ws + Redis + Prometheus)
   ├── client (Vite + three/webgpu; alias source TS)
   ├── api (Fastify + pg + Redis; domain thuần cho ledger)
   └── tools (validator, bot-sim, bench, netsim, loadtest)
```

Ràng buộc phiên bản được ghim chính xác trong từng `package.json`; thư viện mới phải được chấp thuận trước.

## 4. Gameserver

- Mỗi phòng = `MatchSim` + `SimHost`, một vòng lặp 4 ms tích luỹ, tối đa 4 tick/lần để tránh spiral.
- `RoomManager` tạo phòng công khai theo mode+bản đồ, phòng riêng theo mã 6 ký tự.
- Chống lạm dụng: `maxPayload 4096`, 180 message/s, input seq tăng dần, giới hạn tốc độ quay trong sim, chat 1.5 s/lần.
- Ngắt kết nối → bot thay thế, giữ nhãn BOT.
- Quan sát: `/healthz`, `/readyz`, `/metrics` (prom-client); log pino có redact token.
- Trạng thái phòng nằm trong RAM từng tiến trình; Redis hiện dùng cho rate limit API. Muốn scale ngang cần room registry/pub-sub (ghi ở PROGRESS).

## 5. API

- Auth: scrypt (N=16384, r=8, p=1), JWT HS256 15 phút (jti thu hồi khi logout), refresh 30 ngày xoay vòng theo family; phát hiện tái sử dụng → thu hồi family.
- Sổ cái: bảng `ledger_transactions` + `ledger_entries` chỉ ghi thêm (trigger chặn UPDATE/DELETE), mọi bút toán tổng = 0, tài khoản người dùng không âm.
- Idempotency: unique `(user_id, idem_key)`; khóa tài khoản theo thứ tự id để tránh deadlock; chợ khóa listing trước.
- Chợ: phí 10% (từ `data/economy.json`), người bán nhận giá − phí, phí vào tài khoản hệ thống; chuyển quyền sở hữu và trade trong cùng transaction.
- Store: chỉ vật phẩm thẩm mỹ; loot box bị chặn khi flag tắt; pattern/wear sinh phía server.
- `POST /v1/store/purchase`, `POST /v1/market/listings/:id/buy` bắt buộc `Idempotency-Key`.
- Không có endpoint nạp/rút tiền thật hay cashout.

Bảng chính: `users`, `profiles`, `refresh_tokens`, `ledger_accounts`, `ledger_transactions`, `ledger_entries`, `skin_instances`, `market_listings`, `market_trades`, `store_purchases`, `audit_log`. Migration: `apps/api/migrations/001_init.sql`.

## 6. Client

- `RendererHost`: thử WebGPU trước (`three/webgpu`), lỗi → WebGL2; preset Competitive/Low/Medium/High/Ultra; chỉ khác nhau về kỹ thuật hình ảnh, **không** khác hitbox/smoke opacity/flash.
- Map dựng từ JSON (merge geometry theo vật liệu), ánh sáng theo environment, bụi, decal; skin dùng node material palette+seed+wear.
- Prediction: phát lại input chưa ack từ trạng thái server, hiệu chỉnh mượt nếu lệch < 0.35 m, snap nếu lớn hơn; nội suy 31 ms cho người khác.
- UI DOM/CSS thuần; mọi asset đi qua `AssetLoader` (cache, tiến trình, fallback magenta có watermark).
- Listen-server offline: worker import đúng `shared` + `bots`, chạy 64 Hz, gửi snapshot 32 Hz qua `postMessage` (transfer ArrayBuffer).

## 7. Đo đạc (sandbox, 10 bot pro)

| Hạng mục | Kết quả |
|---|---|
| Sim/tick trung bình | ~0.25 ms (ngân sách 15.6 ms) |
| Snapshot | ~260 B, ~65 kbps @32 Hz |
| encode+decode p99 | ~1.0 ms |
| Test | 42 test pass |
| Bundle client | ~1.08 MB (302 kB gzip) + worker 142 kB |

Số đo là trên CPU sandbox, không đại diện GPU thật.
