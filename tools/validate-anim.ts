import { Checker, FORBIDDEN_MARKERS, readJson } from './lib.ts';

const c = new Checker('VALIDATE ANIMATION — rig & clip');
interface Clip { name: string; layer: string; duration: number; loop: boolean; blendIn?: number; blendOut?: number; holdType?: string; source?: string; proc?: string; events?: { at: number; event: string }[]; mask?: string }
interface AnimFile { version: number; rig: { id: string; maxBones: number; bones: string[]; root: string }; clips: Clip[] }

const anim = readJson<AnimFile>('data/animations.json');
const bones = anim.rig.bones;
c.check(new Set(bones).size === bones.length, 'tên bone bị trùng');
c.check(bones.length <= anim.rig.maxBones, `số bone ${bones.length} vượt ${anim.rig.maxBones}`);
c.check(bones.includes(anim.rig.root), 'thiếu root bone');
for (const required of ['pelvis', 'spine_01', 'head', 'hand_l', 'hand_r', 'thigh_l', 'calf_r', 'foot_l', 'weapon_root']) {
  c.check(bones.includes(required), `thiếu bone ${required}`);
}

const names = new Set<string>();
const layerCount: Record<string, number> = {};
for (const clip of anim.clips) {
  c.check(!names.has(clip.name), `trùng clip ${clip.name}`);
  names.add(clip.name);
  layerCount[clip.layer] = (layerCount[clip.layer] ?? 0) + 1;
  c.check(clip.duration > 0 && clip.duration <= 12, `${clip.name}: duration ${clip.duration} không hợp lệ`);
  c.check(clip.blendIn === undefined || (clip.blendIn >= 0 && clip.blendIn < clip.duration), `${clip.name}: blendIn không hợp lệ`);
  c.check(clip.blendOut === undefined || (clip.blendOut >= 0 && clip.blendOut < clip.duration), `${clip.name}: blendOut không hợp lệ`);
  if (clip.layer === 'upper' && /^upper_.+_idle$/.test(clip.name)) c.check(typeof clip.holdType === 'string', `${clip.name}: clip giữ vũ khí cần holdType`);
  for (const ev of clip.events ?? []) {
    c.check(ev.at >= 0 && ev.at <= clip.duration, `${clip.name}: event ${ev.event} ở ${ev.at}s ngoài clip`);
  }
  for (const marker of FORBIDDEN_MARKERS) c.check(!clip.name.toLowerCase().includes(marker.toLowerCase()), `${clip.name}: chứa từ khoá bị cấm`);
  if (clip.source !== 'procedural') c.warn(`${clip.name}: source=${clip.source ?? '?'} cần kiểm giấy phép`);
}

const loco = anim.clips.filter((x) => x.layer === 'locomotion').map((x) => x.name);
for (const required of ['loco_idle', 'loco_walk_f', 'loco_walk_b', 'loco_walk_l', 'loco_walk_r', 'loco_run_f', 'loco_run_b', 'loco_run_l', 'loco_run_r', 'loco_crouch_idle', 'loco_crouch_walk', 'loco_jump_start', 'loco_air', 'loco_land']) {
  c.check(loco.includes(required), `thiếu clip locomotion ${required}`);
}
const holds = new Set(anim.clips.filter((x) => x.layer === 'upper').map((x) => x.holdType));
for (const hold of ['pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'knife', 'grenade']) c.check(holds.has(hold), `thiếu holdType ${hold}`);
const holdsAll = [...names];
for (const kind of ['idle', 'draw', 'fire', 'reload', 'inspect']) {
  c.check(holdsAll.some((n) => n.includes(kind)), `thiếu nhóm clip ${kind}`);
}
c.note(`rig ${anim.rig.id}: ${bones.length}/${anim.rig.maxBones} bone, ${anim.clips.length} clip`);
c.note(Object.entries(layerCount).map(([k, v]) => `${k}=${v}`).join(', '));
process.exit(c.report());
