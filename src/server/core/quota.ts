import { redis, settings } from '@devvit/web/server';
import type { AppMode } from '../../shared/api';

type QuotaResult =
  | { allowed: true }
  | { allowed: false; reason: string };

const modeSettingKey: Record<AppMode, string> = {
  generate: 'quotaGenerate',
  explain: 'quotaExplain',
  conflict: 'quotaConflict',
};

const defaultCaps: Record<AppMode, number> = {
  generate: 50,
  explain: 50,
  conflict: 5,
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

export async function checkQuota(
  subredditName: string,
  mode: AppMode,
  inputTokenEstimate: number
): Promise<QuotaResult> {
  // 1. Kill switch
  const paused = await settings.get<boolean>('paused');
  if (paused) {
    return { allowed: false, reason: 'ModScript is temporarily unavailable. Please try again later.' };
  }

  // 2. Max input size
  const maxTokens = (await settings.get<number>('maxInputTokens')) ?? 50_000;
  if (inputTokenEstimate > maxTokens) {
    return {
      allowed: false,
      reason: `Your AutoModerator config is too large to process (${inputTokenEstimate.toLocaleString()} tokens, limit ${maxTokens.toLocaleString()}). Please reduce the config size.`,
    };
  }

  // 3. Daily quota
  const cap = (await settings.get<number>(modeSettingKey[mode])) ?? defaultCaps[mode];
  const quotaKey = `quota:${subredditName}:${mode}:${todayKey()}`;
  const current = await redis.incrBy(quotaKey, 1);
  if (current === 1) {
    await redis.expire(quotaKey, 172800); // 48h auto-cleanup
  }
  if (current > cap) {
    const label = { conflict: 'Conflict Check', explain: 'Explain', generate: 'Generate' }[mode];
    return {
      allowed: false,
      reason: `Daily ${label} limit reached for this subreddit (${cap} calls/day). Try again tomorrow.`,
    };
  }

  return { allowed: true };
}

export async function logUsage(
  subredditName: string,
  mode: AppMode,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  // Sorted set: score = timestamp, member = JSON payload
  // Cap at 200 entries per subreddit per day
  const key = `usage:${subredditName}:${todayKey()}`;
  const ts = Date.now();
  const member = JSON.stringify({ mode, inputTokens, outputTokens, ts });
  await redis.zAdd(key, { score: ts, member });
  const count = await redis.zCard(key);
  if (count > 200) {
    await redis.zRemRangeByRank(key, 0, count - 201);
  }
  await redis.expire(key, 172800);
}
