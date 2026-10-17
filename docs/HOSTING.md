# Hosting & kiến trúc triển khai

Tài liệu trả lời câu hỏi: *GitHub Actions có làm cổng server được không, và mỗi máy người chơi có thể làm server khi chơi public không?*

## Kết luận ngắn

| Phương án | Chơi được gì | Cần server thường trực? | Phù hợp |
|---|---|---|---|
| **GitHub Pages (client tĩnh)** | Offline 1v1–5v5 với bot, Range, replay | **Không** | Link public miễn phí, demo, portfolio |
| **GitHub Actions** | Chỉ build/test/deploy | — | CI/CD, không phải server |
| **Dedicated Node server** (hiện có) | Online 5v5, phòng riêng, API, DB | Có | Sản phẩm thật |
| **WebRTC P2P host** (chưa làm) | Online casual, host là listen-server trong tab | Không bắt buộc, nhưng cần signaling/TURN | Bản thử nghiệm không server |

## Vì sao GitHub Actions không làm cổng server?

- Mỗi job là máy tạm, chạy xong thì xoá; không có địa chỉ/port public để người chơi kết nối vào.
- Không giữ được WebSocket lâu dài; job có giới hạn thời gian và bị huỷ khi hết.
- Không có state bền vững (trừ artifact/cache, không phù hợp cho phòng đấu).
- Actions miễn phí cho repo public, nhưng đó là **phút build**, không phải **CPU chạy game 24/7**.

→ Actions chỉ dùng để build và deploy client lên Pages.

## Mỗi máy user làm server được không?

Trình duyệt **không thể mở cổng công khai** để người khác kết nối vào như một web server. Cách duy nhất để một tab trình duyệt làm host là:

1. **WebRTC DataChannel**: host chạy mô phỏng listen-server (cùng `MatchSim`/`BotSquad` hiện tại), gửi snapshot cho các peer.
2. **Signaling**: hai bên phải trao đổi SDP/ICE. Có thể:
   - copy/paste mã mời thủ công — **không cần server**, nhưng UX kém và mã rất dài;
   - hoặc một signaling server nhỏ (WebSocket) — lại cần host thường trực.
3. **NAT**: STUN giải quyết được nhiều mạng nhà, nhưng NAT đối xứng/CGNAT cần **TURN relay** (server trả tiền hoặc VPS). Không có TURN thì một số cặp người chơi không kết nối được.
4. **Host-authoritative**: host thấy toàn bộ vị trí nên có thể gian lận; host rời tab là trận dừng; host chịu tải upload (khoảng 9 × 65 kbps nếu snapshot 32 Hz).
5. **Code hiện tại chưa sẵn sàng**: worker chỉ dựng snapshot cho một người xem. P2P nhiều người cần worker dựng snapshot riêng theo PVS cho từng peer + xử lý input từ xa + reconnect.

## Khuyến nghị

- **Có link public ngay, miễn phí:** GitHub Pages + chế độ offline với bot. Không cần CPU server, không cần GitHub Actions lúc chơi.
- **Muốn online public:** giữ kiến trúc dedicated server hiện tại (Node + ws + PostgreSQL/Redis) trên một host thường trực. Có thể dùng VPS giá rẻ, Render/Fly/Railway, hoặc Codespaces để demo tạm (60 giờ máy 2 core/tháng).
- **Muốn online không server (P2P):** coi là một mốc riêng, chấp nhận copy/paste mã mời, tỷ lệ kết nối thất bại với NAT khó, host advantage và không chống gian lận. Không dùng GitHub Actions làm gateway.

## Cách bật link Pages

1. Merge PR vào `main` (workflow `.github/workflows/pages.yml` chỉ chạy trên `main` hoặc chạy tay).
2. **Settings → Pages → Source: GitHub Actions**.
3. Sau khi workflow `pages` xanh: `https://<user>.github.io/<repo>/`.
4. Bản tĩnh tự nhận biết `*.github.io`: màn Chơi online để trống URL và ghi chú chỉ chơi offline; mọi dữ liệu vẫn nằm trong trình duyệt.

## Chi phí tham khảo (kiểm tra lại trước khi dùng)

- GitHub Actions: miễn phí cho repo public trên runner chuẩn; repo private Free có 2.000 phút/tháng.
- GitHub Codespaces cá nhân: 120 core-giờ/tháng (60 giờ máy 2 core) + 15 GB.
- GitHub Pages: miễn phí cho repo public.
- TURN/VPS: tuỳ nhà cung cấp; không có mức "miễn phí vĩnh viễn" đáng tin cho 24/7.
