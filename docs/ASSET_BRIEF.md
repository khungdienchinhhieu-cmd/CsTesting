# ASSET BRIEF — những gì còn thiếu để đạt chất lượng phát hành

Trạng thái hiện tại: **toàn bộ asset là placeholder thủ tục** (manifest `status: placeholder`). Game chạy được, đúng công bằng và hitbox, nhưng chưa đạt chất lượng hình ảnh/âm thanh thương mại. `pnpm release:check` sẽ chặn khi `RELEASE=1` cho tới khi các mục dưới được thay.

## Ưu tiên 1 — hero (chặn phát hành)

| ID | Mô tả | Ngân sách | Định dạng | Tiêu chí đạt |
|---|---|---|---|---|
| `char_t_operator` | Nhân vật T, 3 biến thể đầu/ba lô | 30k tri, 2k tex, 48 bone | GLB, Y-up, 1u=1m | 4 LOD, hitbox khớp rig, không lỗi weights |
| `char_ct_operator` | Nhân vật CT, mũ/giáp | 30k tri, 2k tex, 48 bone | GLB | như trên, màu phe đọc được ở 30 m |
| `vm_rifle_t`, `vm_rifle_ct`, `vm_sniper`, `vm_smg`, `vm_shotgun`, `vm_pistol_heavy` | Viewmodel + tay | 30–60k tri, 2k tex | GLB, tách slide/mag/bolt | đúng tâm ngắm, không che HUD, animation khớp clip |
| `wpn_*` | World model cho 10 súng + dao | 9k tri, 1k tex | GLB | silhouette khác biệt, LOD 2 |
| `map_sandstorm_final` | Art pass Sandstorm | 350k tri, lightmap 4k | GLB + atlas | đọc callout, không kẹt va chạm, đúng luồng T/CT |
| `map_warehouse_final` | Art pass Warehouse | 300k tri | GLB | như trên, ánh sáng trong nhà |

## Ưu tiên 2

- 10 skin material thật thay palette tạm (mask chung 1k + 4 màu), giữ `pattern_seed`/`wear`.
- Bộ âm thanh: 10 súng (bắn/reload/rút), footstep 4 vật liệu, bom (beep/plant/defuse/explode), smoke/flash/molotov, UI, radio. 48 kHz mono WAV nguồn, xuất OGG; ghi license.
- Particle texture: smoke puff 512, flash 256, spark 64, decal 512.
- Font UI có bản quyền thương mại (hiện dùng font hệ thống).

## Quy tắc đặt tên & manifest

- `char_`, `vm_`, `wpn_`, `map_`, `env_`, `fx_`, `sfx_`, `ui_` + tên gốc, không trùng thương hiệu bên thứ ba.
- Mỗi asset phải có entry trong `data/asset_manifest.json`: author, license, source, status, budget, notes có `PLACEHOLDER` nếu chưa final.
- Watermark “PLACEHOLDER” phải hiển thị trên asset chưa đạt (UI overlay hoặc texture).
- Không nhận asset không rõ nguồn gốc hoặc AI không khai báo.

## Pipeline

1. Blockout trong Blender, thang 1u=1m, gốc tại chân/tâm.
2. UV + bake lightmap (map), texture 2k PBR (albedo/normal/ORM).
3. Rig 45–55 bone theo `data/animations.json`, đặt tên `hit_*` cho hitbox.
4. Animation 30 fps, clip naming `loco_*`, `upper_*`, `act_*`; xuất GLB có NLA.
5. Kiểm bằng `pnpm validate:assets` + `pnpm validate:anim`; so ảnh look-dev WebGPU/WebGL2.
6. Chỉ đổi `status` sang `final` sau QA đọc hình + đo tam giác/texture thực tế.

## Đo lường cần đạt

- Map: ≥ 90 FPS preset High ở 1440p trên GPU tầm trung; không quá 160 draw call sau merge.
- Nhân vật: ≤ 40k tri LOD0, ≤ 8k LOD3; 10 nhân vật + viewmodel không vượt 6 ms CPU/GPU.
- Texture VRAM toàn bộ < 512 MB preset High, < 192 MB Competitive.
- Âm thanh: không clipping, peak ≤ −1 dBFS; tổng dung lượng < 40 MB OGG.

## Hiện trạng placeholder (từ manifest)

`proc_lookdev_room`, `proc_character`, `proc_weapon_viewmodel`, `proc_weapon_world`, `map_sandstorm_blockout`, `map_warehouse_blockout`, `map_range_blockout`, `audio_proc_placeholder`, `fx_proc_effects`, `skin_tsl_palette`.

Chưa có asset thật trong repo; không được tuyên bố “đạt chất lượng phát hành” cho tới khi thay thế.
