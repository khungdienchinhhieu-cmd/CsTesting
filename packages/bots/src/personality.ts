import type { BotConfigFile, BotSkillTier } from '@tactical/shared/bot-api';

export interface Personality {
  aggression: number;
  patience: number;
  riskTaking: number;
  utilityDiscipline: number;
  teamwork: number;
  tiltSensitivity: number;
}

export interface RoundMood {
  confidence: number; // -1..1
  tilt: number; // 0..1
}

export function samplePersonality(cfg: BotConfigFile, rng: () => number): Personality {
  const s = (range: { min: number; max: number }) => range.min + (range.max - range.min) * rng();
  return {
    aggression: s(cfg.personality.aggression!),
    patience: s(cfg.personality.patience!),
    riskTaking: s(cfg.personality.riskTaking!),
    utilityDiscipline: s(cfg.personality.utilityDiscipline!),
    teamwork: s(cfg.personality.teamwork!),
    tiltSensitivity: s(cfg.personality.tiltSensitivity!),
  };
}

export function tierOf(cfg: BotConfigFile, tier: string): BotSkillTier {
  return cfg.tiers[tier] ?? cfg.tiers['regular']!;
}
