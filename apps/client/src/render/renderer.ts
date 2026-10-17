import * as THREE from 'three/webgpu';
import type { AssetLoader } from '../assets/loader';

export type GraphicsPreset = 'competitive' | 'low' | 'medium' | 'high' | 'ultra';
export type BackendName = 'webgpu' | 'webgl2';

export interface PresetSettings {
  label: string;
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  smokeLayers: number;
  anisotropy: number;
  msaa: number;
  fog: boolean;
  bloom: number;
}

export const PRESETS: Record<GraphicsPreset, PresetSettings> = {
  competitive: { label: 'Competitive', pixelRatio: 1.0, shadows: false, shadowMapSize: 512, smokeLayers: 8, anisotropy: 2, msaa: 0, fog: true, bloom: 0 },
  low: { label: 'Thấp', pixelRatio: 0.85, shadows: false, shadowMapSize: 512, smokeLayers: 8, anisotropy: 2, msaa: 0, fog: true, bloom: 0 },
  medium: { label: 'Trung bình', pixelRatio: 1.0, shadows: true, shadowMapSize: 1024, smokeLayers: 14, anisotropy: 4, msaa: 2, fog: true, bloom: 0 },
  high: { label: 'Cao', pixelRatio: 1.25, shadows: true, shadowMapSize: 2048, smokeLayers: 20, anisotropy: 8, msaa: 4, fog: true, bloom: 0 },
  ultra: { label: 'Cực cao', pixelRatio: 1.5, shadows: true, shadowMapSize: 4096, smokeLayers: 28, anisotropy: 16, msaa: 4, fog: true, bloom: 0 },
};

export class RendererHost {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(74, 1, 0.06, 600);
  readonly viewScene = new THREE.Scene();
  readonly viewCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  readonly sun = new THREE.DirectionalLight(0xfff0d0, 2.6);
  readonly hemi = new THREE.HemisphereLight(0xd8e6ff, 0x5a4630, 1.4);
  backend: BackendName = 'webgl2';
  preset: GraphicsPreset = 'high';
  private readonly canvas: HTMLCanvasElement;
  private readonly assets: AssetLoader;
  private started = false;
  fpsSamples: number[] = [];
  averageFps = 0;
  frameMs = 0;

  constructor(canvas: HTMLCanvasElement, assets: AssetLoader, forceWebGL = false) {
    this.canvas = canvas;
    this.assets = assets;
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      forceWebGL,
    });
    this.renderer.setClearColor(0x0b0e11, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.fog = new THREE.FogExp2(0xd9c8a4, 0.0085);
    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.viewScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const key = new THREE.DirectionalLight(0xfff2dd, 2.2);
    key.position.set(2, 4, 3);
    this.viewScene.add(key);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  async init(): Promise<{ backend: BackendName; gpuName: string }> {
    await this.renderer.init();
    const backend = (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend;
    this.backend = backend ? 'webgpu' : 'webgl2';
    this.started = true;
    this.applyPreset(this.preset);
    let gpuName = this.backend === 'webgpu' ? 'WebGPU' : 'WebGL2';
    try {
      const gl = this.renderer.getContext();
      if (this.backend === 'webgl2' && gl instanceof WebGL2RenderingContext) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) gpuName = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
      }
    } catch { /* thông tin GPU chỉ để hiển thị */ }
    return { backend: this.backend, gpuName };
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const preset = PRESETS[this.preset];
    const ratio = Math.min(window.devicePixelRatio || 1, preset.pixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = this.camera.aspect;
    this.viewCamera.updateProjectionMatrix();
  }

  applyPreset(preset: GraphicsPreset): void {
    this.preset = preset;
    const p = PRESETS[preset];
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    this.sun.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 160;
    this.sun.shadow.camera.left = -64;
    this.sun.shadow.camera.right = 64;
    this.sun.shadow.camera.top = 64;
    this.sun.shadow.camera.bottom = -64;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.resize();
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  applyEnvironment(env: { skyColor: string; horizonColor: string; sunColor: string; sunDirection: [number, number, number]; ambientColor: string; fogColor: string; fogDensity: number; exposure: number }, sunDir: [number, number, number]): void {
    this.scene.fog = new THREE.FogExp2(env.fogColor, env.fogDensity);
    this.renderer.toneMappingExposure = env.exposure;
    this.sun.color.set(env.sunColor);
    this.sun.intensity = 2.6;
    const dir = new THREE.Vector3(sunDir[0], sunDir[1], sunDir[2]).normalize();
    this.sun.position.copy(dir.multiplyScalar(70));
    this.sun.target.position.set(0, 0, 0);
    this.hemi.color.set(env.skyColor);
    this.hemi.groundColor.set(env.ambientColor);
    this.renderer.setClearColor(new THREE.Color(env.fogColor), 1);
    void this.assets;
  }

  render(): void {
    if (!this.started) return;
    const t0 = performance.now();
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.viewScene, this.viewCamera);
    const ms = performance.now() - t0;
    this.frameMs = this.frameMs * 0.9 + ms * 0.1;
    this.fpsSamples.push(ms > 0 ? 1000 / ms : 0);
    if (this.fpsSamples.length > 60) this.fpsSamples.shift();
    this.averageFps = this.fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, this.fpsSamples.length);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
