import { redis, settings } from '@devvit/web/server';
import type { AppMode, QuotaModeStatus } from '../../shared/api';

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

function quotaRedisKey(subredditName: string, mode: AppMode, dayKey = todayKey()): string {
  return `quota:${subredditName}:${mode}:${dayKey}`;
}

export async function checkQuota(
  subredditName: string,
  mode: AppMode,
  inputTokenEstimate: number,
  bypassDailyQuota = false
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

  if (bypassDailyQuota) {
    return { allowed: true };
  }

  // 3. Daily quota
  const cap = (await settings.get<number>(modeSettingKey[mode])) ?? defaultCaps[mode];
  const quotaKey = quotaRedisKey(subredditName, mode);
  const current = parseInt((await redis.get(quotaKey)) ?? '0', 10);
  if (current >= cap) {
    const label = { conflict: 'Conflict Check', explain: 'Explain', generate: 'Generate' }[mode];
    return {
      allowed: false,
      reason: `Daily ${label} limit reached for this subreddit (${cap} calls/day). Try again tomorrow.`,
    };
  }

  return { allowed: true };
}

export async function incrementQuota(subredditName: string, mode: AppMode): Promise<void> {
  const quotaKey = quotaRedisKey(subredditName, mode);
  const current = await redis.incrBy(quotaKey, 1);
  if (current === 1) {
    await redis.expire(quotaKey, 172800); // 48h auto-cleanup
  }
}

export async function getQuotaStatus(
  subredditName: string
): Promise<Record<AppMode, QuotaModeStatus>> {
  const today = todayKey();
  const [g, e, c] = await Promise.all([
    redis.get(quotaRedisKey(subredditName, 'generate', today)),
    redis.get(quotaRedisKey(subredditName, 'explain', today)),
    redis.get(quotaRedisKey(subredditName, 'conflict', today)),
  ]);
  const capG = (await settings.get<number>('quotaGenerate')) ?? defaultCaps.generate;
  const capE = (await settings.get<number>('quotaExplain'))  ?? defaultCaps.explain;
  const capC = (await settings.get<number>('quotaConflict')) ?? defaultCaps.conflict;
  return {
    generate: { used: Math.min(parseInt(g ?? '0', 10), capG), cap: capG },
    explain:  { used: Math.min(parseInt(e ?? '0', 10), capE), cap: capE },
    conflict: { used: Math.min(parseInt(c ?? '0', 10), capC), cap: capC },
  };
}

export async function resetDailyQuota(subredditName: string): Promise<Record<AppMode, QuotaModeStatus>> {
  const today = todayKey();
  await Promise.all([
    redis.del(quotaRedisKey(subredditName, 'generate', today)),
    redis.del(quotaRedisKey(subredditName, 'explain', today)),
    redis.del(quotaRedisKey(subredditName, 'conflict', today)),
  ]);
  return await getQuotaStatus(subredditName);
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
