import { redis, reddit } from '@devvit/web/server';
import type { WikiRevision } from '../../shared/api';

const WIKI_PAGE = 'config/automoderator';
const MAX_BACKUPS = 5;

export type CurrentWikiConfig = {
  content: string;
  readable: boolean;
  message?: string;
};

function backupIndexKey(subredditName: string): string {
  return `automod:backup-index:${subredditName}`;
}

export function wikiPermissionHelp(): string {
  return 'Manage Wiki Pages permission required. Ask a moderator with Everything or Wiki permissions to grant it.';
}

export async function getCurrent(subredditName: string): Promise<string> {
  const result = await getCurrentWithStatus(subredditName);
  return result.content;
}

export async function getCurrentWithStatus(subredditName: string): Promise<CurrentWikiConfig> {
  try {
    const page = await reddit.getWikiPage(subredditName, WIKI_PAGE);
    return { content: page.content ?? '', readable: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Wiki page could not be read';
    return { content: '', readable: false, message };
  }
}

async function backupCurrent(subredditName: string, content: string): Promise<void> {
  const ts = Date.now();
  const backupKey = `automod:backup:${subredditName}:${ts}`;
  const indexKey = backupIndexKey(subredditName);

  await redis.set(backupKey, content);
  await redis.expire(backupKey, 60 * 60 * 24 * 90); // 90 days

  // Sorted set: score = timestamp, member = backupKey
  await redis.zAdd(indexKey, { score: ts, member: backupKey });
  const count = await redis.zCard(indexKey);
  if (count > MAX_BACKUPS) {
    // Get and delete keys beyond the cap (oldest = lowest score)
    const toRemove = await redis.zRange(indexKey, 0, count - MAX_BACKUPS - 1, { by: 'rank' });
    for (const entry of toRemove) {
      await redis.del(entry.member);
    }
    await redis.zRemRangeByRank(indexKey, 0, count - MAX_BACKUPS - 1);
  }
}

export async function hasLastBackup(subredditName: string): Promise<boolean> {
  const latest = await redis.zRange(backupIndexKey(subredditName), -1, -1, { by: 'rank' });
  return latest.length > 0;
}

export async function getLatestBackup(subredditName: string): Promise<string | null> {
  const latest = await redis.zRange(backupIndexKey(subredditName), -1, -1, { by: 'rank' });
  const first = latest[0];
  const backupKey = typeof first === 'string' ? first : first?.member;
  if (!backupKey) return null;
  return (await redis.get(backupKey)) ?? null;
}

export async function saveAppend(
  subredditName: string,
  newYaml: string,
  summary: string
): Promise<string> {
  const current = await getCurrent(subredditName);
  await backupCurrent(subredditName, current);

  const separator = current.trimEnd().length > 0 ? '\n' : '';
  const combined = current.trimEnd() + separator + newYaml;
  const reason = `ModScript - appended rule: ${summary}`;

  await reddit.updateWikiPage({ subredditName, page: WIKI_PAGE, content: combined, reason });
  return combined;
}

export async function saveReplace(
  subredditName: string,
  newYaml: string,
  summary: string
): Promise<string> {
  const current = await getCurrent(subredditName);
  await backupCurrent(subredditName, current);

  const reason = `ModScript - replaced full config: ${summary}`;
  await reddit.updateWikiPage({ subredditName, page: WIKI_PAGE, content: newYaml, reason });
  return newYaml;
}

export async function restoreLatestBackup(subredditName: string): Promise<string> {
  const backup = await getLatestBackup(subredditName);
  if (backup === null) {
    throw new Error('No ModScript backup is available to undo.');
  }

  const current = await getCurrent(subredditName);
  await backupCurrent(subredditName, current);
  await reddit.updateWikiPage({
    subredditName,
    page: WIKI_PAGE,
    content: backup,
    reason: 'ModScript - undo last save',
  });
  return backup;
}

export async function getRevisions(subredditName: string): Promise<WikiRevision[]> {
  try {
    const page = await reddit.getWikiPage(subredditName, WIKI_PAGE);
    const listing = await page.getRevisions({ limit: 10 });
    const revisions: WikiRevision[] = [];
    for await (const rev of listing) {
      revisions.push({
        id: rev.id,
        timestamp: rev.date.getTime(),
        author: rev.author.username,
        reason: rev.reason ?? '',
      });
      if (revisions.length >= 10) break;
    }
    return revisions;
  } catch {
    return [];
  }
}

export async function getRevisionContent(subredditName: string, revisionId: string): Promise<string> {
  try {
    const page = await reddit.getWikiPage(
      subredditName,
      WIKI_PAGE,
      revisionId as `${string}-${string}-${string}-${string}-${string}`
    );
    return page.content ?? '';
  } catch {
    return '';
  }
}

export async function revertTo(subredditName: string, revisionId: string): Promise<string> {
  const current = await getCurrent(subredditName);
  await backupCurrent(subredditName, current);
  await reddit.revertWikiPage(subredditName, WIKI_PAGE, revisionId);
  return await getCurrent(subredditName);
}
