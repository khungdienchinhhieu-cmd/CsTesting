import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createGameData, GameMap,
  type BotConfigFile, type GameData, type MapJson, type RawEconomyFile, type RawGameplayFile, type RawWeaponsFile,
} from '@tactical/shared';

export interface ServerData {
  data: GameData;
  maps: Record<string, GameMap>;
  bots: BotConfigFile;
}

function readJson<T>(dir: string, rel: string): T {
  return JSON.parse(readFileSync(join(dir, rel), 'utf8')) as T;
}

/** Nạp toàn bộ dữ liệu cân bằng từ /data, không hard-code trong mã. */
export function loadServerData(dataDir?: string): ServerData {
  const dir = resolve(dataDir ?? process.env.DATA_DIR ?? join(__dirname, '../../../data'));
  const weapons = readJson<RawWeaponsFile>(dir, 'weapons.json');
  const gameplay = readJson<RawGameplayFile>(dir, 'gameplay.json');
  const economy = readJson<RawEconomyFile>(dir, 'economy.json');
  const bots = readJson<BotConfigFile>(dir, 'bots.json');
  const data = createGameData(weapons, gameplay, economy);
  const maps: Record<string, GameMap> = {};
  for (const id of ['sandstorm', 'warehouse', 'range']) {
    maps[id] = new GameMap(readJson<MapJson>(dir, `maps/${id}.json`));
  }
  return { data, maps, bots };
}
