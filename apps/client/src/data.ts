import weaponsRaw from '../../../data/weapons.json';
import gameplayRaw from '../../../data/gameplay.json';
import economyRaw from '../../../data/economy.json';
import botsRaw from '../../../data/bots.json';
import settingsRaw from '../../../data/settings.default.json';
import sandstormRaw from '../../../data/maps/sandstorm.json';
import warehouseRaw from '../../../data/maps/warehouse.json';
import rangeRaw from '../../../data/maps/range.json';
import skinsRaw from '../../../data/skins/defs.json';
import animationsRaw from '../../../data/animations.json';
import { createGameData, parseMap, type BotConfigFile, type GameData, type GameMap } from '@tactical/shared';

export type DataBundle = {
  data: GameData;
  maps: Record<string, GameMap>;
  bots: BotConfigFile;
  settings: typeof settingsRaw;
  skins: typeof skinsRaw;
  animations: typeof animationsRaw;
};

let cached: DataBundle | null = null;

export function loadData(): DataBundle {
  if (cached) return cached;
  const data = createGameData(weaponsRaw as never, gameplayRaw as never, economyRaw as never);
  const maps = [sandstormRaw, warehouseRaw, rangeRaw].map((m) => parseMap(m as never));
  cached = {
    data,
    maps: Object.fromEntries(maps.map((m) => [m.json.id, m])),
    bots: botsRaw as unknown as BotConfigFile,
    settings: settingsRaw,
    skins: skinsRaw,
    animations: animationsRaw,
  };
  return cached;
}

export const DEFAULT_SETTINGS = settingsRaw;
