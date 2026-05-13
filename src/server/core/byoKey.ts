import { redis, settings } from '@devvit/web/server';

function byoKeyRedisKey(subredditName: string): string {
  return `gemini:byo-key:${subredditName}`;
}

export async function getSubredditGeminiApiKey(subredditName: string): Promise<string | null> {
  const key = await redis.get(byoKeyRedisKey(subredditName));
  return key?.trim() || null;
}

export async function getGeminiApiKey(subredditName: string): Promise<{ apiKey: string; source: 'subreddit' | 'global' }> {
  const subredditKey = await getSubredditGeminiApiKey(subredditName);
  if (subredditKey) {
    return { apiKey: subredditKey, source: 'subreddit' };
  }

  const globalKey = ((await settings.get('geminiApiKey')) as string | undefined)?.trim();
  if (!globalKey) {
    throw new Error('Gemini API key is not configured.');
  }

  return { apiKey: globalKey, source: 'global' };
}

export async function setSubredditGeminiApiKey(subredditName: string, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (trimmed.length < 20) {
    throw new Error('API key looks too short.');
  }
  await redis.set(byoKeyRedisKey(subredditName), trimmed);
}

export async function removeSubredditGeminiApiKey(subredditName: string): Promise<void> {
  await redis.del(byoKeyRedisKey(subredditName));
}
