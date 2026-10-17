# PROGRESS — TACTICAL STRIKE

Cập nhật: 2026-10-17 · nhánh `arena/13bff6a5-cstesting`

## Kế hoạch 22 mốc (M0–M21)

1. M0 Khung monorepo, ADR, look-dev, manifest asset, CI
2. M1 Pipeline dữ liệu JSON + validator
3. M2 Lõi mô phỏng: toán, hằng số, types, RNG, protocol khung
4. M3 Di chuyển, va chạm, hitbox, navmesh
5. M4 Vũ khí, sát thương, giáp, lựu đạn, ném
6. M5 Vòng đấu, kinh tế, bom, MR12/MR6, overtime
7. M6 Ranh giới bot: `BotSensorView` / `BotCommand`
8. M7 AI 3 tầng: chiến thuật, vai trò, cá nhân, comms, sai sót, telemetry
9. M8 Protocol nhị phân, snapshot, lag compensation
10. M9 Client shell + renderer WebGPU/WebGL2 + map/vũ khí
11. M10 Dự đoán, reconciliation, nội suy
12. M11 HUD, menu, mua đồ, bảng điểm, chat
13. M12 Listen-server offline trong Web Worker
14. M13 Ba bản đồ Sandstorm/Warehouse/Range + ánh sáng
15. M14 Skin uber-shader, armory, màn hình kho đồ
16. M15 Âm thanh không gian + sự kiện lượng tử hoá
17. M16 Gameserver có thẩm quyền, phòng, PVS, metrics
18. M17 API xác thực, hồ sơ, PostgreSQL, Redis
19. M18 Chợ, sổ cái ghi kép, idempotency, test race
20. M19 Client online: matchmaking, phòng riêng, spectator
21. M20 Replay, spectator, công cụ đo tải/hiệu năng
22. M21 Gia cố, trợ năng, i18n, cổng phát hành, tài liệu

## Trạng thái thực tế

| Mốc | Trạng thái | Bằng chứng / ghi chú |
|---|---|---|
| M0 | ✅ | Monorepo pnpm, tsconfig strict, ESLint ranh giới bot, CI, `tools/*`, docs, manifest. Look-dev có module nhưng **chưa có trang riêng**. |
| M1 | ✅ | `pnpm validate:data` ĐẠT; BFS kiểm đường đi 3 map. |
| M2 | ✅ | `pnpm test` (shared) pass; RNG tất định. |
| M3 | ✅ | Movement/collision/navmesh có test; bot đi được. |
| M4 | ✅ | 10 súng + 5 lựu đạn + giáp; test sát thương/giáp/headshot/falloff. |
| M5 | ✅ | MR12/MR6/deathmatch/range, kinh tế, bom, overtime; test round. |
| M6 | ✅ | `packages/shared/src/bot-api.ts`; ESLint chặn import ngoài bot-api. |
| M7 | ✅ | 3 tầng AI, belief/aim/recoil/comms/mistakes/telemetry; `bot-sim` chạy. |
| M8 | ✅ | Protocol bit-packed, snapshot, history 128 tick, lag comp; netsim 0 lỗi giải mã. |
| M9 | ✅ (chưa kiểm trình duyệt) | Renderer WebGPU→WebGL2, TSL map/skin/viewmodel/effects; `vite build` pass. **Không có Chromium/GPU trong sandbox → chưa kiểm chứng hình ảnh.** |
| M10 | ✅ (chưa kiểm trình duyệt) | Predictor + reconcile + interp; logic có, chưa đo trong browser. |
| M11 | ✅ (chưa kiểm trình duyệt) | Menu armory/settings/pause/results, HUD, buy menu, scoreboard, chat, hitmarker. |
| M12 | ✅ | Worker listen-server dùng chung shared/bots; dev server phục vụ worker OK. |
| M13 | ⚠️ placeholder | 3 blockout + callout/buy zone; **chưa có art pass/lightmap thật**. |
| M14 | ⚠️ placeholder | 6 skin TSL palette+seed+wear, armory local; **chưa có material thật**. |
| M15 | ⚠️ placeholder | Web Audio thủ tục + spatial/occlusion cơ bản; **chưa có thư viện âm thanh**. |
| M16 | ✅ | Phòng 64 Hz, snapshot 32 Hz, PVS, reconnect→bot, rate limit, metrics; test WS pass. |
| M17 | ✅ (SQL chưa chạy) | Auth scrypt/JWT/refresh rotation, profile, migration, Redis rate limit; test in-memory pass. **Chưa chạy Postgres thật.** |
| M18 | ✅ (SQL chưa chạy) | Sổ cái ghi kép, chợ, fee, idempotency, audit; 6 test domain + race pass. |
| M19 | ✅ (chưa kiểm trình duyệt) | `OnlineSession` (WS, snapshot nhị phân, ping, tự kết nối lại), menu online, proxy Vite; test tích hợp client↔server PASS. |
| M20 | ✅ (một phần) | Replay tất định (seed + input, test trùng khớp trạng thái), lưu 3 trận gần nhất trong localStorage, phát lại bằng worker; spectator trực tiếp. `loadtest` viết nhưng **chưa chạy**. |
| M21 | ⚠️ một phần | Đã có trợ năng (phụ đề âm thanh, 4 bảng màu, tương phản cao, giảm chuyển động, cỡ HUD), pipeline GitHub Pages, `loadtest` đã chạy; **chưa i18n, chưa kiểm browser thật**. |

## Kết quả đo (sandbox, không GPU)

- `pnpm lint`: ĐẠT.
- `pnpm typecheck`: ĐẠT toàn bộ 6 package.
- `pnpm test`: **47 test / 15 file ĐẠT** (shared, replay codec + tất định, bots, gameserver WS, client online session, API HTTP, ledger/market race).
- `pnpm bench:sim` (10 bot pro): trung bình **0.253 ms/tick**, p95 0.465 ms, p99 3.46 ms; ngân sách 15.625 ms → dùng 1.6%.
- `pnpm netsim` (loss 2%): **~65 kbps**, 260 B/snapshot, encode+decode p99 ~1.05 ms, 0 lỗi giải mã.
- `pnpm loadtest` (gameserver `/healthz`): **2.000 request / 25 luồng → 1.823 RPS, 0 lỗi, p50 9.6 ms, p95 28.6 ms, p99 58.8 ms, max 68.9 ms** (CPU sandbox).
- `pnpm --filter @tactical/client build`: JS 1,103.60 kB (308.49 kB gzip) + worker 144.97 kB, CSS 26.84 kB.
- `pnpm release:check`: **THẤT BẠI có chủ đích** — 10 asset placeholder. Dùng `pnpm release:check:dev` cho CI/phát triển.

## Vấn đề đang mở (ưu tiên giảm dần)

1. **Chưa kiểm chứng hình ảnh WebGPU/WebGL2** trong trình duyệt thật (sandbox không có Chromium/GPU). Cần chạy `pnpm dev:client` trên máy có GPU, kiểm tra: menu, Sandstorm, smoke/flash, skin, preset Competitive→Ultra, FPS.
2. **Online chưa kiểm chứng trong trình duyệt thật**: `OnlineSession` + menu đã nối và test tích hợp bằng Node WebSocket PASS, nhưng chưa bấm thử UI trong Chromium. Cần kiểm: Quick Play, mã phòng riêng, reconnect, nhãn BOT.
3. **Postgres/Redis chưa chạy thật** trong sandbox → SQL migration, khóa hàng, trigger append-only, Redis limiter mới chỉ được review/typecheck.
4. **Bot chưa đủ giống người**: trong sim 5v5, phe T thắng cách biệt, độ chính xác ~11%, nhiều `stuck_escape`. Cần tinh chỉnh path, tầm giao tranh, burst và test telemetry dài hơn.
5. **Replay còn giới hạn**: chỉ lưu 3 trận gần nhất trong localStorage, chưa xuất/nhập tệp, chưa có tua tua/đổi tốc độ, chưa có free-cam; spectator chỉ xem trực tiếp.
6. **Asset placeholder** → chất lượng hình ảnh/âm thanh chưa đạt phát hành; xem `docs/ASSET_BRIEF.md`.
7. Bundle client 1.08 MB chưa code-split; ba.js chiếm phần lớn.
8. Log test API còn ồn (pino level info trong test).
9. Chưa có E2E Playwright chạy được trong môi trường này.

## Bước tiếp theo

1. M21 còn lại: i18n đầy đủ (hiện chỉ tiếng Việt), kiểm browser thật trên máy có GPU, tinh chỉnh trợ năng theo phản hồi người dùng.
2. Replay nâng cao: tua/đổi tốc độ, xuất/nhập tệp, free-cam; spectator tự do.
3. Tinh chỉnh bot + test telemetry dài (plant/defuse, economy, comms); bot hiện thắng cách biệt phe T trong sim dài.
4. Chạy `docker compose up` trên máy có Docker; kiểm migration/sổ cái/chợ thật; thêm test tích hợp Postgres.
5. Trang look-dev riêng (WebGPU/WebGL2, so sánh preset, đo FPS) + script Playwright chụp ảnh.
6. Art/audio pass theo ASSET_BRIEF; bật dần asset thật, cập nhật manifest.

## Quy ước

- Không dùng tài sản/tên thương hiệu bên thứ ba. Không có cashout. Flag nhạy cảm mặc định tắt.
- Mọi số liệu không đo được trong sandbox đều ghi “chưa kiểm chứng”, không suy đoán.

## Báo cáo M19 — Client online

**Tệp chính**
- `apps/client/src/sim/client-session.ts` — giao diện chung offline/online cho `GameView`.
- `apps/client/src/sim/online.ts` — WebSocket session: hello/welcome, giải mã frame snapshot (bỏ byte marker 1), ping RTT, chat, buy, tự kết nối lại giữ mã phòng.
- `apps/client/src/ui/menus.ts` — màn "Chơi online": URL máy chủ, chế độ, bản đồ, phe, bot bù, độ khó, mã phòng.
- `apps/client/src/main.ts` — tạo `OnlineSession` riêng cho mỗi trận, thoái lui về menu khi lỗi.
- `apps/client/vite.config.ts` — proxy `/ws` → 8443 và `/api` → 8080.
- `tests/client/online-session.test.ts` — test tích hợp dựng gameserver thật, kiểm hello/welcome, snapshot nhị phân, mua, chat, ping.
- `apps/gameserver/src/rooms.ts` — sửa rate-limit chat nuốt tin nhắn đầu tiên.

**Cách chạy**
```bash
pnpm dev:server   # gameserver 8443
pnpm dev:client   # client 5173, proxy /ws
# mở http://localhost:5173 → "Chơi online"
```
Hoặc `docker compose up --build` (chưa chạy được trong sandbox — xem ghi chú).

**Cổng chất lượng**: lint/typecheck 0 lỗi; vitest 43/43; client build PASS; validate-data/anim/assets PASS; `release:check:dev` PASS.

**Đo**: test online chạy ~0.9 s (dựng server + 1 phiên), snapshot 32 Hz, ping RTT cập nhật 2.5 s/lần; chưa đo trong trình duyệt.

**Bảo mật**: token gửi qua hello (không đặt trong URL); server giới hạn payload 4 KB, 180 msg/s, chat 1.5 s/lần; guest chỉ chơi, không vào inventory; snapshot nhị phân không chứa vị trí địch bị che khuất (lọc PVS phía server).

**Vấn đề mở**: chưa kiểm UI online trong Chromium; reconnect chưa được test khi mạng chập chờn thật; chưa có quick-match/đội hình người thật.

**Bước tiếp**: đo trong trình duyệt, bổ sung phòng riêng trong menu. (M20 replay đã hoàn tất ở báo cáo dưới.)

## Báo cáo M20 — Replay, spectator, đo tải

**Tệp chính**
- `packages/shared/src/replay.ts` — định dạng replay v1 (meta + input lượng tử hoá), `ReplayRecorder`, `encodeReplay`/`decodeReplay`, `quantizeInputCommand`.
- `apps/client/src/sim/worker.ts` — ghi input mỗi tick, chốt replay khi `match_end`; chế độ phát lại dựng lại `MatchSim` + `BotSquad` từ seed rồi nạp input theo tick.
- `apps/client/src/game/replay-store.ts` — lưu tối đa 3 replay trong localStorage, giới hạn 2 MB/bản, xoá được.
- `apps/client/src/ui/menus.ts` + `main.ts` — màn "Xem lại trận", nút Xem/Xoá.
- `apps/client/src/game/gameview.ts` — chế độ replay không nhận input, không ghi thống kê hồ sơ.
- `tests/shared/replay.test.ts` — codec, chống dữ liệu hỏng, giới hạn người chơi.
- `tests/sim/replay.test.ts` — **chạy lại 600 tick với 1 người + 3 bot, trạng thái trùng khớp tuyệt đối** (vị trí, máu, tiền, điểm, phase).

**Cách chạy**: chơi một trận offline → kết thúc → menu "Xem lại trận". Chỉ replay offline; online chưa ghi replay.

**Đo**: 600 tick dựng lại trong ~0.16 s (sandbox), replay 1 người + 3 bot không sai lệch trạng thái. `loadtest` chưa chạy vì không có môi trường tải; sẽ ghi số khi chạy được.

**Bảo mật**: replay là dữ liệu cục bộ, không chứa token; `decodeReplay` giới hạn 500k dòng/10 người, kiểm kiểu từng trường; không eval.

**Vấn đề mở**: chưa có xuất/nhập tệp, tua, đổi tốc độ, free-cam; replay online chưa ghi; phát lại trong trình duyệt chưa được kiểm bằng Chromium.

**Bước tiếp**: M21 (i18n, trợ năng, kiểm browser, tải thật), rồi tinh chỉnh bot/asset.

## Báo cáo M21 (một phần) — Trợ năng, host public, đo tải

**Tệp chính**
- `apps/client/src/ui/hud.ts` + `style.css` — phụ đề âm thanh `aria-live`, 4 bảng màu mù màu, tương phản cao, phụ đề/thông báo, cỡ HUD 85–125% (`zoom`), tắt animation khi giảm chuyển động.
- `apps/client/src/game/gameview.ts` — mô tả tiếng súng/bước chân/tiếng bom theo hướng và khoảng cách, giới hạn 350 ms; tắt rung camera khi giảm chuyển động.
- `apps/client/src/game/store.ts` + `data/settings.default.json` — nhánh `accessibility` (colorBlind, subtitles, highContrast, uiScale).
- `apps/client/src/ui/menus.ts` — thẻ TRỢ NĂNG trong Cài đặt.
- `apps/client/src/main.ts` — áp `data-color-blind`, `data-high-contrast`, `data-reduced-motion`; dừng xoay look-dev khi giảm chuyển động.
- `.github/workflows/pages.yml` — build tĩnh và deploy GitHub Pages.
- `apps/client/src/sim/online.ts` — trên `*.github.io` để trống URL server và hiện gợi ý.

**Cách chạy**
```bash
pnpm dev:client            # thử trợ năng trong Cài đặt
pnpm loadtest --url=http://127.0.0.1:8443/healthz --n=2000 --c=25
# GitHub Pages: Settings → Pages → Source: GitHub Actions → push main
```

**Cổng**: lint/typecheck 0 lỗi · 47 test/15 file PASS · client build PASS · validate 3 bộ PASS · release check dev PASS (strict vẫn chặn 10 placeholder).

**Đo**: loadtest 1.823 RPS, p99 58.8 ms, 0 lỗi. Kiểm tĩnh kiểu Pages: phục vụ `dist` dưới `/CsTesting/`, index/JS/worker đều 200.

**Bảo mật**: không có secret trong client; Pages chỉ file tĩnh; online yêu cầu `wss://` do người dùng nhập, không tự hạ cấp bảo mật.

**Vấn đề mở**: i18n chưa làm (UI chỉ tiếng Việt); cỡ HUD dùng CSS `zoom` chưa kiểm trên Firefox/Safari; chưa kiểm trợ năng bằng trình đọc màn hình thật; WebGPU/WebGL2 vẫn chưa chạy trong Chromium của sandbox.

**Bước tiếp**: i18n vi/en, kiểm browser thật + trợ năng, rồi art/audio pass.
