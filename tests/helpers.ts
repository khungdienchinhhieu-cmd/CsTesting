import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createGameData, parseMap, type GameData, type GameMap, type MapJson } from '@tactical/shared';
import type { BotConfigFile } from '@tactical/shared/bot-api';

const root = resolve(__dirname, '..');

export function testData(): GameData {
  const weapons = JSON.parse(readFileSync(resolve(root, 'data/weapons.json'), 'utf8'));
  const gameplay = JSON.parse(readFileSync(resolve(root, 'data/gameplay.json'), 'utf8'));
  const economy = JSON.parse(readFileSync(resolve(root, 'data/economy.json'), 'utf8'));
  return createGameData(weapons, gameplay, economy);
}

export function testMap(id = 'sandstorm'): GameMap {
  const json = JSON.parse(readFileSync(resolve(root, `data/maps/${id}.json`), 'utf8')) as MapJson;
  return parseMap(json);
}

export function testBots(): BotConfigFile {
  return JSON.parse(readFileSync(resolve(root, 'data/bots.json'), 'utf8')) as BotConfigFile;
}

export function makeInput(seq: number, overrides: Partial<import('@tactical/shared').InputCommand> = {}): import('@tactical/shared').InputCommand {
  return {
    seq, tick: 0, dt: 1 / 64, forward: 0, right: 0, yaw: 0, pitch: 0,
    buttons: 0, grenadeSlot: 0, viewTick: 0, ...overrides,
  };
}
