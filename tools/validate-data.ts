import { Checker, DATA, readJson, type MapJson } from './lib.ts';

const c = new Checker('VALIDATE DATA — cân bằng & bản đồ');

interface WeaponsFile { weapons: { id: string; slot: string; category: string; price: number; damage: number; rpm: number; magazine: number; reserve: number; reloadTime: number; spread: Record<string, number>; recoil: { pattern: [number, number][] }; sound: string }[]; grenades: { id: string; kind: string; price: number; radius: number; fuse: number }[]; equipment: { id: string; price: number }[] }
interface GameplayFile { tickRate: number; round: Record<string, number>; movement: Record<string, number>; smoke: Record<string, number>; flash: Record<string, number>; combat: Record<string, number> }
interface EconomyFile { currency: string; startMoney: number; maxMoney: number; winReward: number; lossBase: number; lossStep: number; lossMax: number; marketFeePercent: number; marketMinPrice: number; marketMaxPrice: number; marketMaxOpenListings: number; marketTradeLockHours: number }
interface BotsFile { tiers: Record<string, Record<string, number> & { label: string }>; roles: string[]; shared: Record<string, number> }
interface SkinsFile { skins: { id: string; status: string; weapons: string[]; palette: string[]; textureBudget: number; rarity: string }[]; rarityWeights: Record<string, number>; wearBuckets: { id: string; min: number; max: number }[]; collections: { id: string }[] }
interface StoreFile { products: { id: string; price: number; type: string; items?: string[]; credits?: number }[] }
interface AnimFile { clips: { name: string; layer: string; duration: number; holdType?: string; source: string }[]; rig: { bones: string[]; maxBones: number } }

const weapons = readJson<WeaponsFile>('data/weapons.json');
const gameplay = readJson<GameplayFile>('data/gameplay.json');
const economy = readJson<EconomyFile>('data/economy.json');
const bots = readJson<BotsFile>('data/bots.json');
const skins = readJson<SkinsFile>('data/skins/defs.json');
const store = readJson<StoreFile>('data/store.json');
const anim = readJson<AnimFile>('data/animations.json');

const weaponIds = new Set(weapons.weapons.map((w) => w.id));
c.check(gameplay.tickRate === 64, `tickRate phải là 64 (đang ${gameplay.tickRate})`);
c.check(gameplay.round.roundTimeSec > gameplay.round.freezeTimeSec, 'thời gian round phải lớn hơn freeze');
c.check(gameplay.round.buyTimeSec <= gameplay.round.roundTimeSec, 'thời gian mua không vượt round');
c.check(gameplay.movement.walkMultiplier > 0 && gameplay.movement.walkMultiplier < 1, 'walkMultiplier phải trong (0,1)');
c.check(gameplay.smoke.voxelGrid >= 16 && gameplay.smoke.voxelGrid <= 64, 'smoke voxel phải 16..64');
c.check(gameplay.flash.maxBlindSec > 0 && gameplay.flash.maxBlindSec <= 5, 'flash maxBlindSec không hợp lệ');

const ids = new Set<string>();
for (const w of weapons.weapons) {
  c.check(!ids.has(w.id), `trùng weapon id ${w.id}`);
  ids.add(w.id);
  c.check(w.price >= 0 && w.price <= 10000, `${w.id}: giá ngoài phạm vi`);
  c.check(w.damage > 0 && w.damage <= 200, `${w.id}: damage ngoài phạm vi`);
  c.check(w.rpm > 0 && w.rpm <= 1200, `${w.id}: rpm ngoài phạm vi`);
  c.check(w.magazine >= 0 && w.reserve >= 0, `${w.id}: đạn âm`);
  if (w.category !== 'knife') {
    c.check(w.reloadTime > 0 && w.reloadTime <= 6, `${w.id}: reload không hợp lệ`);
    c.check(w.recoil.pattern.length >= 3, `${w.id}: pattern recoil quá ngắn`);
  }
  c.check(['stand', 'crouch', 'walk', 'run', 'jump'].every((k) => typeof w.spread[k] === 'number'), `${w.id}: thiếu spread`);
  c.check(weaponIds.has(w.id), 'unreachable');
}
for (const g of weapons.grenades) c.check(g.price >= 0 && g.radius > 0 && g.fuse > 0, `${g.id}: thông số lựu đạn không hợp lệ`);
for (const e of weapons.equipment) c.check(e.price >= 0, `${e.id}: giá âm`);

const expectedLoss = Math.min(economy.lossMax, economy.lossBase + economy.lossStep * 4);
c.check(expectedLoss === economy.lossMax, 'lossMax phải đạt sau chuỗi thua (1400 + 500*4 = 3400)');
c.check(economy.winReward === 3250, 'winReward phải 3250');
c.check(economy.lossBase === 1400, 'lossBase phải 1400');
c.check(economy.startMoney === 800, 'startMoney phải 800');
c.check(economy.currency === 'Credits', 'tiền tệ phải là Credits');
c.check(economy.marketFeePercent >= 0 && economy.marketFeePercent <= 25, 'marketFeePercent ngoài 0..25');
c.check(economy.marketMinPrice >= 1 && economy.marketMaxPrice > economy.marketMinPrice, 'giá chợ không hợp lệ');
c.check(economy.marketMaxOpenListings > 0 && economy.marketTradeLockHours >= 0, 'giới hạn chợ không hợp lệ');

const tierNames = Object.keys(bots.tiers);
c.check(tierNames.length >= 5, 'cần 5 bậc bot (rookie→pro)');
let prevReaction = Infinity;
for (const [name, t] of Object.entries(bots.tiers)) {
  c.check(typeof t.label === 'string' && t.label.length > 0, `${name}: thiếu label`);
  c.check(t.reactionMedianMs > 0 && t.reactionMedianMs < 1000, `${name}: reaction không hợp lệ`);
  c.check(t.reactionMedianMs <= prevReaction + 1, `reaction phải giảm dần theo bậc (lỗi ở ${name})`);
  prevReaction = t.reactionMedianMs;
  c.check(t.aimErrorDeg > 0 && t.aimErrorDeg < 10, `${name}: aimErrorDeg không hợp lệ`);
  c.check(t.mistakeRate >= 0 && t.mistakeRate <= 0.6, `${name}: mistakeRate không hợp lệ`);
}
c.check(Array.isArray(bots.roles), 'bots.roles phải là mảng');
for (const role of ['entry', 'support', 'lurker', 'anchor', 'awper', 'igl']) c.check(bots.roles.includes(role), `thiếu role ${role}`);
for (const k of ['commsDelayMinSec', 'commsDelayMaxSec', 'navPathReplanSec', 'maxTurnRateDegPerSec']) {
  c.check(typeof bots.shared[k] === 'number', `bots.shared thiếu ${k}`);
}
c.check(bots.shared.commsDelayMinSec <= bots.shared.commsDelayMaxSec, 'comms delay min > max');

for (const mapId of ['sandstorm', 'warehouse', 'range']) {
  const map = readJson<MapJson>(`data/maps/${mapId}.json`);
  const width = map.layout[0]?.length ?? 0;
  c.check(width >= 16 && map.layout.length >= 16, `${mapId}: bản đồ quá nhỏ`);
  c.check(map.layout.every((row) => row.length === width), `${mapId}: layout không vuông vắn`);
  c.check(map.cellSize >= 1 && map.cellSize <= 4, `${mapId}: cellSize không hợp lệ`);
  c.check(map.spawns.T.length >= 3 && map.spawns.CT.length >= 3, `${mapId}: cần ≥3 spawn mỗi phe`);
  c.check(mapId === 'range' ? map.sites.length === 0 : map.sites.length === 2, `${mapId}: số bom site không hợp lệ`);
  c.check(map.buyZones.T.length > 0 && map.buyZones.CT.length > 0, `${mapId}: thiếu buy zone`);
  const walk = (x: number, z: number): boolean => {
    const col = Math.floor((x - map.origin[0]) / map.cellSize);
    const row = Math.floor((z - map.origin[2]) / map.cellSize);
    const ch = map.layout[row]?.[col] ?? '#';
    return ch !== '#' && ch !== 'x' && ch !== 'X' && ch !== 'h';
  };
  for (const team of ['T', 'CT'] as const) for (const [x, y, z] of map.spawns[team]) {
    c.check(walk(x, z), `${mapId}: spawn ${team} (${x},${z}) không đi được`);
    void y;
  }
  for (const s of map.sites) {
    const [cx, , cz] = s.center;
    c.check(walk(cx, cz), `${mapId}: site ${s.id} center không đi được`);
  }
  // BFS từ spawn T phải tới được spawn CT và 2 site.
  const cellsAt = (x: number, z: number): [number, number] => [Math.floor((x - map.origin[0]) / map.cellSize), Math.floor((z - map.origin[2]) / map.cellSize)];
  const [sc, sr] = cellsAt(map.spawns.T[0]![0], map.spawns.T[0]![2]);
  const seen = new Set<string>([`${sc},${sr}`]);
  const queue: [number, number][] = [[sc, sr]];
  while (queue.length) {
    const [cc, rr] = queue.pop()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = cc + dc, nr = rr + dr, k = `${nc},${nr}`;
      if (seen.has(k)) continue;
      const ch = map.layout[nr]?.[nc] ?? '#';
      if (ch === '#' || ch === 'x' || ch === 'X' || ch === 'h') continue;
      seen.add(k); queue.push([nc, nr]);
    }
  }
  for (const [x, , z] of map.spawns.CT) {
    const k = cellsAt(x, z).join(',');
    c.check(seen.has(k), `${mapId}: không có đường từ spawn T tới CT (${x},${z})`);
  }
  for (const s of map.sites) {
    const k = cellsAt(s.center[0], s.center[2]).join(',');
    c.check(seen.has(k), `${mapId}: không có đường tới site ${s.id}`);
  }
  if (mapId !== 'range') c.check(map.sites.some((s) => s.id === 'A') && map.sites.some((s) => s.id === 'B'), `${mapId}: thiếu site A/B`);
  c.note(`${mapId}: ${width}x${map.layout.length}, ${map.sites.length} site, ${map.spawns.T.length}v${map.spawns.CT.length} spawn`);
}

const skinIds = new Set<string>();
const collections = new Set(skins.collections.map((x) => x.id));
for (const s of skins.skins) {
  c.check(!skinIds.has(s.id), `trùng skin ${s.id}`);
  skinIds.add(s.id);
  c.check(s.status === 'active' || s.status === 'draft', `${s.id}: status lạ`);
  c.check(s.palette.length === 4 && s.palette.every((p) => /^#[0-9a-fA-F]{6}$/.test(p)), `${s.id}: palette phải 4 màu hex`);
  c.check(s.textureBudget >= 256 && s.textureBudget <= 2048, `${s.id}: textureBudget ngoài 256..2048`);
  c.check(s.weapons.every((w) => weaponIds.has(w)), `${s.id}: skin tham chiếu vũ khí không tồn tại`);
  c.check(s.weapons.every((w) => weapons.weapons.find((x) => x.id === w)?.slot !== 'knife' || w === 'knife'), `${s.id}: skin gắn sai slot`);
  c.check(skins.collections.some((col) => col.id === (s as { collection?: string }).collection), `${s.id}: collection không tồn tại`);
}
for (const col of skins.collections) c.check(collections.has(col.id), 'unreachable');
const rarityTotal = Object.values(skins.rarityWeights).reduce((a, b) => a + b, 0);
c.check(Math.abs(rarityTotal - 1) < 0.01, `rarityWeights phải cộng ~1 (đang ${rarityTotal})`);
let lastMax = 0;
for (const b of skins.wearBuckets) {
  c.check(Math.abs(b.min - lastMax) < 1e-6, `wear bucket ${b.id} không liên tục`);
  c.check(b.max > b.min, `wear bucket ${b.id} rỗng`);
  lastMax = b.max;
}
c.check(Math.abs(lastMax - 1) < 1e-6, 'wear buckets phải phủ tới 1.0');

const productIds = new Set<string>();
for (const p of store.products) {
  c.check(!productIds.has(p.id), `trùng product ${p.id}`);
  productIds.add(p.id);
  c.check(p.price >= 0, `${p.id}: giá âm`);
  c.check(p.type !== 'loot_box', `${p.id}: không được bán loot box khi flag tắt`);
  for (const item of p.items ?? []) {
    c.check(skins.skins.some((s) => s.id === item && s.status === 'active'), `${p.id}: item ${item} không tồn tại/không active`);
  }
}

const clipNames = new Set(anim.clips.map((x) => x.name));
c.check(clipNames.size === anim.clips.length, 'trùng tên animation clip');
c.check(anim.rig.bones.length <= anim.rig.maxBones, 'số bone vượt maxBones');
for (const clip of anim.clips) {
  c.check(clip.duration > 0 && clip.duration <= 12, `${clip.name}: duration không hợp lệ`);
  c.check(['locomotion', 'upper', 'weapon', 'additive', 'override'].includes(clip.layer), `${clip.name}: layer lạ`);
}
for (const w of weapons.weapons) {
  const hold = anim.clips.some((x) => x.layer === 'upper' && x.holdType === w.category);
  c.check(hold, `${w.id}: thiếu clip upper holdType=${w.category}`);
}

c.note(`${weapons.weapons.length} vũ khí, ${weapons.grenades.length} lựu đạn, ${skins.skins.length} skin, ${anim.clips.length} clip`);
c.note(`data dir: ${DATA}`);
process.exit(c.report());
