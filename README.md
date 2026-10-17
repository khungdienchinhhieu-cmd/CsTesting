# TACTICAL STRIKE

FPS chiến thuật 5v5 gỡ bom trên trình duyệt — IP gốc, không dùng tài nguyên hay tên thương hiệu của bên thứ ba.
Mô phỏng 64 Hz chạy chung cho offline (Web Worker listen-server), server Node.js và test; renderer three.js WebGPU (TSL) với fallback WebGL2.

## Chạy nhanh

```bash
corepack enable
pnpm install
pnpm dev:client          # http://localhost:5173 — offline với bot, hoặc "Chơi online"
pnpm dev:server          # gameserver :8443 (WS /ws, HTTP /healthz /metrics) — bắt buộc cho online
pnpm dev:api             # API :8080 (mặc định chạy in-memory nếu chưa có DATABASE_URL)
pnpm docker:up           # postgres + redis + api + gameserver + client tĩnh
```

Yêu cầu: Node.js >= 22.12, pnpm 10.x. Không cần GPU rời; preset `competitive` chạy được trên WebGL2.

## Điều khiển

| Phím | Chức năng |
|---|---|
| WASD / Shift / Ctrl / Space | di chuyển / đi chậm / ngồi / nhảy |
| Chuột trái / phải | bắn / ngắm (scope) |
| R / 1 / 2 / 3 / 4 / Q | nạp đạn / súng chính / súng phụ / dao / lựu đạn / đổi lựu đạn |
| B (giữ trong vùng mua) | mở menu mua |
| TAB | bảng điểm |
| Sau trận | replay tự lưu (tối đa 3 trận) — xem ở menu **Xem lại trận** |
| Y / U | chat đội / chat chung |
| K | radio |
| ESC | pause / nhả chuột |

## Script

| Lệnh | Ý nghĩa |
|---|---|
| `pnpm lint` | ESLint toàn repo (có luật ranh giới bot) |
| `pnpm typecheck` | tsc strict từng package |
| `pnpm test` | Vitest: sim, protocol, bot, sổ cái, chợ, gameserver, API |
| `pnpm validate:data` | kiểm JSON cân bằng + bản đồ (BFS đường đi) |
| `pnpm validate:anim` | kiểm rig/clip |
| `pnpm validate:assets` | kiểm manifest, license, ngân sách |
| `pnpm release:check` | cổng phát hành nghiêm ngặt (chặn khi còn asset placeholder) |
| `pnpm release:check:dev` | như trên nhưng chỉ cảnh báo placeholder (dùng cho CI) |
| `pnpm run ci` | lint + typecheck + test + 3 validator + release check dev |
| `pnpm bot-sim --matches=3` | chạy trận bot headless, in telemetry |
| `pnpm bench:sim` | ngân sách tick |
| `pnpm netsim` | băng thông snapshot, mất gói |
| `pnpm loadtest --url=…` | đo tải HTTP |
| `pnpm test:e2e` | Playwright (cần tải browser; xem docs) |

## Host link công khai (GitHub)

| Cách | Miễn phí | Làm được gì | Không làm được |
|---|---|---|---|
| GitHub Pages | Có (repo public) | Host **client tĩnh**: chơi offline với bot, xem replay | Không chạy gameserver/API, không có `/ws` |
| GitHub Codespaces | 120 core-giờ/tháng (60 giờ máy 2 core) + 15 GB | Chạy thử cả client + server, mở port public tạm thời | Máy tự tắt khi rảnh; không phải hosting production |
| GitHub Actions | Miễn phí cho repo public | Build/test/deploy tự động | Không host server chạy dài (job có hạn, không có ingress) |

Pipeline Pages đã có ở `.github/workflows/pages.yml`. Để bật: **Settings → Pages → Source: GitHub Actions**, sau đó push/merge lên `main` (hoặc chạy workflow `pages` thủ công). Link dạng `https://<user>.github.io/CsTesting/`. Bản tĩnh chỉ chơi **offline**; muốn online phải nhập `wss://…/ws` của một máy chủ Node riêng.

## Online

1. Chạy `pnpm dev:server` (và `pnpm dev:api` nếu cần tài khoản/lưu trữ).
2. `pnpm dev:client`, mở `http://localhost:5173`, chọn **Chơi online**.
3. Vite proxy `/ws` → `127.0.0.1:8443`; bản build tĩnh dùng nginx trong `docker-compose.yml` cũng proxy `/ws` và `/api`.
4. Có thể nhập mã phòng để vào phòng riêng; để trống để vào phòng mới. Client tự kết nối lại và giữ mã phòng trong 30 giây phòng còn trống.
5. Chưa đăng nhập thì chơi với tên khách (guest); tài khoản/credits/chợ cần API + PostgreSQL.

Lưu ý: **chưa kiểm chứng UI online trong Chromium** trong môi trường này; test tích hợp dùng WebSocket Node đã PASS (xem `tests/client/online-session.test.ts`).

## Cấu trúc

- `packages/shared` — toán, bản đồ, va chạm, navmesh, movement, vũ khí, bom, round, protocol nhị phân, snapshot, `SimHost`, `BotSensorView`.
- `packages/bots` — AI 3 tầng: chiến thuật đội, vai trò, cá nhân; chỉ thấy qua `BotSensorView`.
- `apps/client` — Vite + three.js WebGPU/TSL; DOM UI; worker listen-server.
- `apps/gameserver` — Fastify + ws, phòng 64 Hz, snapshot 32 Hz, PVS chống wallhack.
- `apps/api` — Fastify + PostgreSQL (Kysely migrations) + Redis rate limit; auth, kho đồ, chợ, sổ cái.
- `tools` — validator, bot-sim, bench, netsim, loadtest.

## Trạng thái trung thực

Bản dựng hiện tại: **47 test / 15 file PASS**, lint/typecheck 0 lỗi, build client PASS. Replay tất định đã được kiểm bằng test (600 tick trùng khớp trạng thái). **Mỹ thuật vẫn là placeholder thủ tục** — cổng phát hành sẽ chặn cho tới khi thay asset thật (xem `docs/ASSET_BRIEF.md`, `PROGRESS.md`). WebGPU/WebGL2 chưa được kiểm bằng trình duyệt thật trong môi trường build này (không có Chromium/GPU); mọi tuyên bố hình ảnh cần tự kiểm tra trên máy bạn. PostgreSQL/Redis và `docker compose` chưa chạy thật trong sandbox — SQL mới được review/typecheck.

## Pháp lý & feature flag

Chỉ dùng Credits (tiền ảo trong game), không có nạp/rút tiền thật, không loot box, không giao dịch trực tiếp. Feature flag mặc định TẮT và chỉ được bật sau khi đọc `docs/LEGAL_CHECKLIST.md`. `realMoneyCashout` bị cấm và không tồn tại trong mã.
