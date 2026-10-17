import type { SkinInstance } from '../render/skins';

export interface GraphicsSettings {
  preset: 'competitive' | 'low' | 'medium' | 'high' | 'ultra';
  resolutionScale: number;
  dynamicResolution: boolean;
  targetFps: number;
  taa: boolean;
  sharpen: boolean;
  bloom: number;
  smokeQuality: string;
  particleQuality: string;
  shadowQuality: string;
  hdr: boolean;
}

export interface ClientSettings {
  version: number;
  sensitivity: number;
  zoomSensitivityMultiplier: number;
  fov: number;
  viewmodelFov: number;
  invertY: boolean;
  rawInput: boolean;
  audio: { master: number; sfx: number; music: number; voice: number };
  graphics: GraphicsSettings;
  hud: {
    crosshair: { style: string; size: number; gap: number; thickness: number; color: string; outline: boolean; dot: boolean };
    showFps: boolean; showNetGraph: boolean; radarZoom: number; hudScale: number;
  };
  gameplay: { autoPickup: boolean; toggleWalk: boolean; toggleCrouch: boolean; switchOnEmpty: boolean; showDamageNumbers: boolean; reducedMotion: boolean; minimalHitEffects: boolean; language: string };
  accessibility: { colorBlind: 'off' | 'deuteranopia' | 'protanopia' | 'tritanopia'; subtitles: boolean; highContrast: boolean; uiScale: number };
  keybinds: Record<string, string>;
  privacy: Record<string, unknown>;
}

export interface OwnedSkin extends SkinInstance {
  obtainedAt: number;
}

export interface Profile {
  version: number;
  name: string;
  credits: number;
  ownedSkins: OwnedSkin[];
  equipped: Record<string, SkinInstance>;
  stats: { matches: number; wins: number; kills: number; deaths: number; headshots: number; damage: number };
  createdAt: number;
}

const SETTINGS_KEY = 'tacticalstrike.settings.v1';
const PROFILE_KEY = 'tacticalstrike.profile.v1';

function deepMerge<T>(base: T, patch: unknown): T {
  if (typeof base !== 'object' || base === null) return (patch === undefined ? base : patch) as T;
  if (typeof patch !== 'object' || patch === null) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b !== null && typeof b === 'object' ? deepMerge(b, v) : v;
  }
  return out as T;
}

export class SettingsStore {
  value: ClientSettings;
  constructor(defaults: ClientSettings) {
    let saved: unknown = null;
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'); } catch { saved = null; }
    this.value = saved ? deepMerge(defaults, saved) : structuredClone(defaults);
  }
  save(): void {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.value)); } catch { /* storage có thể bị chặn */ }
  }
  reset(defaults: ClientSettings): void {
    this.value = structuredClone(defaults);
    this.save();
  }
}

const DEFAULT_OWNED: OwnedSkin[] = [
  { skinId: 'finish_dune_veil', patternSeed: 4127, wear: 0.18, tally: 0, obtainedAt: 0 },
  { skinId: 'finish_ember_wash', patternSeed: 881, wear: 0.42, tally: 7, obtainedAt: 0 },
];

export class ProfileStore {
  value: Profile;
  constructor(defaultName: string) {
    let saved: unknown = null;
    try { saved = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null'); } catch { saved = null; }
    this.value = saved && typeof saved === 'object'
      ? { ...this.blank(defaultName), ...(saved as Partial<Profile>), stats: { ...this.blank(defaultName).stats, ...(saved as Partial<Profile>).stats } }
      : this.blank(defaultName);
    this.save();
  }
  private blank(name: string): Profile {
    return {
      version: 1, name, credits: 2500, ownedSkins: structuredClone(DEFAULT_OWNED), equipped: {},
      stats: { matches: 0, wins: 0, kills: 0, deaths: 0, headshots: 0, damage: 0 }, createdAt: Date.now(),
    };
  }
  save(): void {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(this.value)); } catch { /* noop */ }
  }
  own(skinId: string): boolean { return this.value.ownedSkins.some((s) => s.skinId === skinId); }
  equippedFor(weaponId: string): SkinInstance | null {
    const e = this.value.equipped[weaponId];
    if (!e) return null;
    if (!this.value.ownedSkins.some((s) => s.skinId === e.skinId)) return null;
    return e;
  }
  equip(weaponId: string, inst: SkinInstance | null): void {
    if (inst) this.value.equipped[weaponId] = inst;
    else delete this.value.equipped[weaponId];
    this.save();
  }
  addStats(add: Partial<Profile['stats']>): void {
    for (const [k, v] of Object.entries(add)) {
      this.value.stats[k as keyof Profile['stats']] += v ?? 0;
    }
    this.save();
  }
}

export const FEATURE_FLAGS = {
  realMoneyTopup: false,
  lootBoxes: false,
  directTrading: false,
  voiceChat: false,
  userGeneratedSkins: false,
  realMoneyCashout: 'forbidden',
} as const;

export function readFlag(name: keyof typeof FEATURE_FLAGS): boolean | 'forbidden' { return FEATURE_FLAGS[name]; }
