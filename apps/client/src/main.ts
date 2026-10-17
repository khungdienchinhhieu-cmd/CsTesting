import './style.css';
import * as THREE from 'three/webgpu';
import { loadData, type DataBundle } from './data';
import { AssetLoader } from './assets/loader';
import { RendererHost } from './render/renderer';
import { buildMapVisual, type MapVisual } from './render/mapMesh';
import { AudioSystem } from './audio/audio';
import { InputManager } from './game/input';
import { ProfileStore, SettingsStore, type ClientSettings } from './game/store';
import { OfflineSession } from './sim/session';
import { OnlineSession } from './sim/online';
import type { ClientSession } from './sim/client-session';
import { GameView } from './game/gameview';
import { Menus } from './ui/menus';
import { Hud } from './ui/hud';
import { ReplayStore } from './game/replay-store';
import { decodeReplay } from '@tactical/shared';

const boot = document.getElementById('boot-screen') as HTMLElement;
const bootFill = document.getElementById('boot-fill') as HTMLElement;
const bootStatus = document.getElementById('boot-status') as HTMLElement;
const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

function setBoot(pct: number, text: string): void {
  bootFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  bootStatus.textContent = text;
}

async function main(): Promise<void> {
  setBoot(6, 'Đang tải dữ liệu trò chơi…');
  const bundle: DataBundle = loadData();
  const assets = new AssetLoader();
  const settings = new SettingsStore(bundle.settings as unknown as ClientSettings);
  const profile = new ProfileStore('Operator');
  const replayStore = new ReplayStore();
  const audio = new AudioSystem();
  await audio.unlock();

  setBoot(14, 'Đang khởi tạo renderer…');
  const forceGL = new URLSearchParams(location.search).get('webgl') === '1';
  const host = new RendererHost(canvas, assets, forceGL);
  const info = await host.init();
  canvas.addEventListener('pointerdown', () => { void audio.unlock(); });

  setBoot(26, 'Đang sinh texture procedural…');
  await assets.loadAll((done, total, label) => setBoot(26 + (done / total) * 46, `Asset ${done}/${total} · ${label}`));

  setBoot(76, 'Đang dựng cảnh menu…');
  const input = new InputManager(canvas, settings.value.keybinds as never);
  const session = new OfflineSession();
  const hudMap = bundle.maps.sandstorm!;
  const hud = new Hud(uiRoot, bundle, settings.value, hudMap, {
    onBuy: (id) => gameView?.buy(id),
    onCloseBuy: () => gameView?.closeBuy(),
  });
  const menus = new Menus(uiRoot, bundle, settings, profile, replayStore, {
    onStart: (opts) => beginMatch(session, opts),
    onStartOnline: (opts) => {
      onlineSession?.destroy();
      onlineSession = new OnlineSession();
      beginMatch(onlineSession, opts);
    },
    onWatchReplay: (json) => {
      let data;
      try { data = decodeReplay(json); } catch { menus.toast('Tệp replay không hợp lệ', true); return; }
      const meta = data.meta;
      const mode = meta.mode === 'quick' ? 'quick' : meta.mode === 'deathmatch' ? 'deathmatch' : meta.mode === 'range' ? 'range' : 'competitive';
      const me = meta.players.find((p) => p.id === meta.youId);
      beginMatch(session, {
        name: me?.name ?? 'Replay', mode, mapId: meta.mapId,
        team: me?.team ?? 'T', botsPerSide: 0, tier: 'regular', replay: data,
      });
    },
    onSettingsChanged: () => applyRuntime(),
    onEquip: () => { gameView?.refreshCosmetics(); },
    onResume: () => gameView?.resume(),
    onQuit: () => quitToMenu(),
    onRestart: () => gameView?.restart(),
  });

  session.onReplay = (json) => {
    const saved = replayStore.save(json);
    menus.toast(saved ? 'Đã lưu replay trận vừa rồi.' : 'Không lưu được replay (bộ nhớ đầy hoặc dữ liệu lỗi).', !saved);
  };

  let gameView: GameView | null = null;
  let onlineSession: OnlineSession | null = null;
  let lookdev: MapVisual | null = null;
  let lookdevAngle = 0.4;
  let menuRaf = 0;

  const applyRuntime = (): void => {
    const s = settings.value;
    settings.save();
    document.body.dataset.colorBlind = s.accessibility.colorBlind;
    document.body.dataset.highContrast = String(s.accessibility.highContrast);
    document.body.dataset.reducedMotion = String(s.gameplay.reducedMotion);
    host.applyPreset(s.graphics.preset);
    host.setFov(s.fov);
    input.sensitivity = s.sensitivity;
    input.zoomSensitivity = s.zoomSensitivityMultiplier;
    input.invertY = s.invertY;
    input.keybinds = s.keybinds as never;
    audio.setVolumes({ master: s.audio.master, sfx: s.audio.sfx, ambience: s.audio.music, voice: s.audio.voice });
    hud.applySettings(s);
    if (gameView) gameView.refreshCosmetics();
  };

  function buildLookdev(): void {
    if (lookdev) { host.scene.remove(lookdev.group); lookdev.dispose(); lookdev = null; }
    const map = bundle.maps.sandstorm!;
    lookdev = buildMapVisual(map, assets);
    host.scene.add(lookdev.group);
    host.applyEnvironment(map.json.environment, map.json.lights[0]?.direction ?? map.json.environment.sunDirection);
    host.scene.fog = new THREE.FogExp2(map.json.environment.fogColor, map.json.environment.fogDensity * 0.8);
  }

  function menuLoop(): void {
    cancelAnimationFrame(menuRaf);
    const tick = (): void => {
      menuRaf = requestAnimationFrame(tick);
      if (document.body.dataset.screen !== 'menu') return;
      if (!settings.value.gameplay.reducedMotion) lookdevAngle += 0.00016;
      const r = 52;
      host.camera.position.set(Math.cos(lookdevAngle) * r, 19 + Math.sin(lookdevAngle * 0.7) * 3, Math.sin(lookdevAngle) * r);
      host.camera.lookAt(0, 1.5, 0);
      host.camera.rotation.order = 'YXZ';
      if (lookdev) {
        if (!settings.value.gameplay.reducedMotion) {
          lookdev.dust.rotation.y += 0.0004;
          lookdev.dust.position.y = Math.sin(performance.now() * 0.0001) * 0.3;
        }
      }
      host.render();
    };
    tick();
  }

  function enterMenu(): void {
    document.body.dataset.screen = 'menu';
    if (!lookdev) buildLookdev();
    menuLoop();
  }

  function quitToMenu(): void {
    if (gameView) {
      gameView.dispose();
      gameView = null;
    }
    session.destroy();
    onlineSession?.destroy();
    onlineSession = null;
    hud.setVisible(false);
    input.setEnabled(false);
    input.releaseLock();
    menus.show('main');
    menus.hideResults();
    menus.hidePause();
    buildLookdev();
    enterMenu();
  }

  function beginMatch(active: ClientSession, opts: Parameters<GameView['start']>[0]): void {
    document.body.dataset.screen = 'game';
    cancelAnimationFrame(menuRaf);
    if (lookdev) { host.scene.remove(lookdev.group); lookdev.dispose(); lookdev = null; }
    input.requestLock();
    void audio.unlock();
    menus.setStatus(opts.url ? 'Đang kết nối máy chủ…' : 'Đang dựng trận đấu…');
    if (gameView) { gameView.dispose(); gameView = null; }
    gameView = new GameView(host, bundle, assets, audio, settings.value, profile, hud, menus, input, active, {
      onExit: () => quitToMenu(),
      onPause: () => menus.showPause(),
    });
    void gameView.start(opts).catch((err: unknown) => {
      menus.toast(err instanceof Error ? err.message : String(err), true);
      quitToMenu();
    });
  }

  applyRuntime();
  menus.setBackendInfo(info.backend, info.gpuName);
  menus.setStatus(assets.missing() ? 'Một số asset dùng fallback — xem asset manifest.' : 'Asset procedural đã sẵn sàng.');
  menus.refreshProfile();
  enterMenu();

  setBoot(100, 'Sẵn sàng');
  window.setTimeout(() => boot.classList.add('hidden'), 260);
  window.setTimeout(() => { boot.style.display = 'none'; }, 800);

  window.addEventListener('beforeunload', () => {
    gameView?.dispose();
    session.destroy();
    onlineSession?.destroy();
    assets.dispose();
    host.dispose();
  });
  (window as unknown as { __TS__?: unknown }).__TS__ = { host, bundle, gameView: () => gameView, settings, profile, menus };
  void lookdev;
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
  bootStatus.textContent = `Không khởi động được: ${msg.split('\n')[0]}`;
  bootStatus.style.color = '#ff9a94';
  console.error(err);
});
