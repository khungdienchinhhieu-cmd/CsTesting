# ART BIBLE — TACTICAL STRIKE

## Định hướng

Chiến thuật hiện đại, khô, nắng gắt, công nghiệp nhẹ. Silhouette rõ để đọc nhanh trong 0.2 s; màu môi trường bị nén (desaturated) để phe T (hổ phách) và CT (xanh lạnh) nổi bật. Không yếu tố siêu nhiên, không máu me; va chạm dùng bụi/tia lửa/decal.

## Bảng màu

| Vai trò | Màu | Ghi chú |
|---|---|---|
| Nền Sandstorm | `#b08a5a` cát, `#7a6248` đá, `#3d3830` bóng | nắng ấm 5200K |
| Nền Warehouse | `#4e5458` bê tông, `#6b4b32` gỗ, `#2c3238` thép | đèn công nghiệp 3800K |
| T | `#e0a341` hổ phách | dải vai/ba lô phản quang |
| CT | `#5b9fd6` xanh lạnh | dải vai/ba lô phản quang |
| Nguy hiểm | `#d8452f` | bom, cảnh báo |
| UI | `#0b0e11` nền, `#e0b442` nhấn | chữ `#e8e3d8` |

Độ tương phản tối thiểu: nhân vật với nền ≥ 3:1 ở vùng silhouette; không dùng đỏ/lam tinh khiết cho đồng đội để tránh nhầm.

## Hình khối & ngân sách

| Loại | Tam giác | Texture | Ghi chú |
|---|---|---|---|
| Viewmodel hero | 30–60k | 2k albedo + 1k normal/rough | 12–18 khúc khớp |
| Nhân vật | 25–40k | 2k | 45–55 bone, 4 LOD |
| Map hero | 250–450k | 2k atlas + lightmap 4k | 100–160 draw call sau merge |
| Prop | 300–3000 | 512–1k | instance hoá |
| Skin | palette 4 màu + mask | 1k | uber-shader, không asset riêng từng súng |

## Ánh sáng

- Baked GI lightmap cho map (không dùng realtime GI).
- CSM 2–3 cascade, shadow 2048/4096; contact shadow cho viewmodel.
- Phơi sáng: nắng 8–12 EV, trong nhà 5–7 EV; tone map AgX/Khronos PBR Neutral.
- Fog nhẹ theo bụi; volumetric smoke chỉ ở preset High/Ultra, fallback billboard ở WebGL2/Low/Competitive.
- **Công bằng hình ảnh:** opacity smoke, bán kính, thời gian, flash trắng, độ dày tường, hitbox giống nhau ở mọi preset. Chỉ khác số mẫu, bóng, hậu kỳ.

## Nhân vật

- T: quần sa mạc, áo khoác ngắn, khăn cổ, ba lô; CT: giáp nhẹ, quần tối, mũ bảo hộ.
- Đầu/ngực/đùi có khối riêng để đọc hitbox; không phụ kiện che tay súng.
- Màu phe nằm ở vai + lưng (dễ thấy từ xa), không ở tay súng.
- Animation: locomotion 8 hướng, crouch, jump/land, ADS, reload theo khẩu, inspect, plant/defuse, chết 5 hướng. Blend 0.12–0.25 s; footstep khớp event.

## Vũ khí

- Ngôn ngữ: công cụ dã chiến, ray kim loại, ốp polymer; khác biệt silhouette theo category.
- Viewmodel đặt lệch phải, không che tâm; animation recoil có kick + settle.
- Skin chỉ đổi vật liệu/palette, không đổi hình khối để giữ công bằng hitbox.

## UI/HUD

- Góc cạnh vát 2–6 px, chữ condensed uppercase, số tabular.
- Thông tin thiết yếu trong 30° trung tâm: HP, giáp, đạn, tiền; killfeed góc phải trên; radar góc trái trên.
- Màu BOT luôn hiển thị cạnh tên trong online.
- Không hiệu ứng rung lắc màn hình quá 0.35°; hỗ trợ giảm chuyển động.

## Âm thanh

- Súng: transient sắc, tail ngắn theo không gian; footstep theo vật liệu; xa dần có low-pass.
- Flash: ring 6–8 kHz rồi ù; smoke: tiếng “khò” rồi im; bom: beep tăng tần theo thời gian.
- Không dùng âm thanh có bản quyền; mọi file ghi nguồn/giấy phép trong manifest.

## Quy trình asset

Blockout → silhouette pass → UV/lightmap → material pass → animation → audio → QA đọc hình. Mỗi bước lưu ảnh so sánh trong `art/review/` (chưa có trong repo).
