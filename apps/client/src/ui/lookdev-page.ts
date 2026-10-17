import assetManifest from '../../../../data/asset_manifest.json';
import { PRESETS, type RendererHost } from '../render/renderer';
import type { SettingsStore } from '../game/store';

type ManifestAsset = { id: string; type: string; status: string; hero?: boolean; notes?: string };
const assets = (assetManifest as unknown as { assets: ManifestAsset[] }).assets;

export interface LookdevDeps {
  root: HTMLElement;
  host: RendererHost;
  settings: SettingsStore;
  info: { backend: string; gpuName: string };
  onClose: () => void;
}

/**
 * Trang chẩn đoán renderer (mở bằng ?lookdev=1).
 * Mục đích: cho người dùng kiểm tra bằng mắt những thứ sandbox không kiểm được —
 * backend WebGPU/WebGL2, preset, FPS, danh sách asset placeholder.
 */
export function mountLookdev(deps: LookdevDeps): () => void {
  const { root, host, settings, info, onClose } = deps;
  const panel = document.createElement('div');
  panel.className = 'lookdev-panel';
  panel.innerHTML = `
    <div class="ld-head">
      <div><b>LOOK-DEV / CHẨN ĐOÁN</b><span>kiểm renderer trên máy bạn</span></div>
      <button class="ld-x" id="ld-close" aria-label="Đóng">✕</button>
    </div>
    <div class="ld-row"><span>Backend</span><b id="ld-backend">${info.backend.toUpperCase()}</b></div>
    <div class="ld-row"><span>GPU</span><b id="ld-gpu" title="${info.gpuName}">${info.gpuName.slice(0, 34)}</b></div>
    <div class="ld-row"><span>FPS</span><b id="ld-fps">—</b></div>
    <div class="ld-row"><span>Frame</span><b id="ld-frame">—</b></div>
    <div class="ld-row"><span>Preset</span><b id="ld-preset">${settings.value.graphics.preset}</b></div>
    <div class="ld-presets" id="ld-presets">
      ${(['competitive', 'low', 'medium', 'high', 'ultra'] as const).map((p) => `<button data-preset="${p}" class="${settings.value.graphics.preset === p ? 'on' : ''}">${p}</button>`).join('')}
    </div>
    <div class="ld-links">
      <a class="ld-link" href="?lookdev=1&webgl=1">Ép WebGL2</a>
      <a class="ld-link" href="?lookdev=1">Tự động (WebGPU→WebGL2)</a>
      <button class="ld-link" id="ld-report">Sao chép báo cáo</button>
    </div>
    <div class="ld-check">
      <b>// KIỂM BẰNG MẮT</b>
      <ul>
        <li>Menu xoay cảnh Sandstorm, không lỗi shader</li>
        <li>Vào trận: súng trong tay, bot chuyển động</li>
        <li>Khói / flash / vết đạn hiển thị</li>
        <li>Đổi preset: FPS đổi, độ mờ khói <i>không</i> đổi</li>
        <li>Resize cửa sổ không vỡ khung hình</li>
      </ul>
    </div>
    <div class="ld-assets">
      <b>// ASSET (${assets.filter((a) => a.status === 'placeholder').length} placeholder / ${assets.length})</b>
      ${assets.map((a) => `<div class="ld-asset ${a.status === 'placeholder' ? 'ph' : ''}"><span>${a.id}</span><span>${a.type}${a.hero ? ' · HERO' : ''}</span><em>${a.status}</em></div>`).join('')}
    </div>
    <div class="ld-foot">Preset chỉ đổi chất lượng hiển thị; hitbox/khói/flash giữ nguyên. Số đo chỉ có nghĩa trên máy đang mở.</div>`;
  root.appendChild(panel);

  const $ = (id: string): HTMLElement | null => panel.querySelector(`#${id}`);
  const backend = $('ld-backend');
  if (backend) backend.textContent = host.backend.toUpperCase();

  panel.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const preset = b.dataset.preset as keyof typeof PRESETS;
    settings.value.graphics.preset = preset;
    settings.save();
    host.applyPreset(preset);
    panel.querySelectorAll('[data-preset]').forEach((x) => x.classList.toggle('on', x === b));
    const label = $('ld-preset');
    if (label) label.textContent = preset;
  }));

  const timer = window.setInterval(() => {
    const fps = $('ld-fps');
    const frame = $('ld-frame');
    if (fps) fps.textContent = host.averageFps > 0 ? host.averageFps.toFixed(0) : '—';
    if (frame) frame.textContent = host.frameMs > 0 ? `${host.frameMs.toFixed(2)} ms` : '—';
  }, 400);

  const report = (): void => {
    const data = {
      backend: host.backend,
      gpu: info.gpuName,
      preset: settings.value.graphics.preset,
      fps: Math.round(host.averageFps),
      frameMs: Number(host.frameMs.toFixed(2)),
      userAgent: navigator.userAgent,
      webgpu: typeof (navigator as unknown as { gpu?: unknown }).gpu === 'object',
      placeholders: assets.filter((a) => a.status === 'placeholder').length,
      at: new Date().toISOString(),
    };
    const text = JSON.stringify(data, null, 2);
    void navigator.clipboard?.writeText(text).then(
      () => { const btn = $('ld-report'); if (btn) btn.textContent = 'Đã sao chép ✓'; },
      () => { const btn = $('ld-report'); if (btn) btn.textContent = 'Không sao chép được'; },
    );
  };
  $('ld-report')?.addEventListener('click', report);
  $('ld-close')?.addEventListener('click', onClose);

  return () => {
    window.clearInterval(timer);
    panel.remove();
  };
}
