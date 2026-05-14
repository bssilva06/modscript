import { Hono } from 'hono';
import { context, reddit, redis, settings } from '@devvit/web/server';
import type {
  InitResponse,
  PrivacyAckResponse,
  GenerateRequest,
  GenerateResponse,
  ExplainRequest,
  ExplainResponse,
  ConflictRequest,
  ConflictResponse,
  SaveRequest,
  SaveResponse,
  UndoLastSaveResponse,
  RevisionsResponse,
  RevertRequest,
  RevertResponse,
  RevisionContentResponse,
  ErrorResponse,
  ValidateYamlRequest,
  ValidateYamlResponse,
  DemoConfigResponse,
  RuleTestRequest,
  RuleTestResponse,
  ByoKeyStatusResponse,
  SetByoKeyRequest,
  SetByoKeyResponse,
  ResetQuotaResponse,
} from '../../shared/api';
import { checkQuota, incrementQuota, logUsage, getQuotaStatus, resetDailyQuota } from '../core/quota';
import {
  getCurrent,
  getCurrentWithStatus,
  saveAppend,
  saveReplace,
  getRevisions,
  revertTo,
  getRevisionContent,
  restoreLatestBackup,
  hasLastBackup,
  getLatestBackup,
  wikiPermissionHelp,
} from '../core/wiki';
import { generateRule, explainConfig, conflictCheck, estimateTokens } from '../core/gemini';
import { getTemplate } from '../core/templates';
import { validateAutomodYaml } from '../core/yaml';
import { DEMO_AUTOMOD_CONFIG } from '../core/demo';
import { getGeminiApiKey, getSubredditGeminiApiKey, removeSubredditGeminiApiKey, setSubredditGeminiApiKey } from '../core/byoKey';
import { getConflictGateStatus } from '../core/iap';
import { testAutomodRules } from '../core/ruleTester';

export const api = new Hono();

function normalizeModPermissionNames(modPermissions: unknown[]): string[] {
  return modPermissions.map((permission) => String(permission));
}

function canManageSubredditKey(modPermissionNames: string[]): boolean {
  return modPermissionNames.includes('all') || modPermissionNames.includes('config') || modPermissionNames.includes('wiki');
}

async function getCurrentUserModPermissionNames(subredditName: string): Promise<string[]> {
  const currentUser = await reddit.getCurrentUser();
  const modPermissions = currentUser ? await currentUser.getModPermissionsForSubreddit(subredditName) : [];
  return normalizeModPermissionNames(modPermissions);
}

api.get('/init', async (c) => {
  const { postId, subredditName } = context;

  if (!postId || !subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing context' }, 400);
  }

  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const currentUser = await reddit.getCurrentUser();
    const [privacyRaw, currentWiki, quota, modPermissions, byoKey, conflictGate, lastBackupAvailable, debugToolsEnabled] = await Promise.all([
      redis.get(`privacy:acked:${subredditName}:${username}`),
      getCurrentWithStatus(subredditName),
      getQuotaStatus(subredditName),
      currentUser?.getModPermissionsForSubreddit(subredditName) ?? Promise.resolve([]),
      getSubredditGeminiApiKey(subredditName),
      getConflictGateStatus(),
      hasLastBackup(subredditName),
      settings.get<boolean>('debugToolsEnabled'),
    ]);
    const modPermissionNames = normalizeModPermissionNames(modPermissions);
    const wikiWritable = modPermissionNames.includes('wiki') || modPermissionNames.includes('all');

    return c.json<InitResponse>({
      type: 'init',
      postId,
      subredditName,
      username,
      privacyAcked: privacyRaw === 'true',
      currentConfig: currentWiki.content,
      quota,
      readiness: {
        wikiReadable: currentWiki.readable,
        wikiWritable,
        modPermissions: modPermissionNames,
        message: currentWiki.message,
      },
      byoKeyConfigured: Boolean(byoKey),
      conflictGate,
      lastBackupAvailable,
      debugToolsEnabled: Boolean(debugToolsEnabled),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message: `Init failed: ${msg}` }, 400);
  }
});

api.post('/validate-yaml', async (c) => {
  const body = await c.req.json<ValidateYamlRequest>();
  return c.json<ValidateYamlResponse>(validateAutomodYaml(body.content));
});

api.get('/demo-config', (c) => {
  return c.json<DemoConfigResponse>({ type: 'demo-config', yaml: DEMO_AUTOMOD_CONFIG });
});

api.post('/test-rules', async (c) => {
  const body = await c.req.json<RuleTestRequest>();
  try {
    const validation = validateAutomodYaml(body.config);
    if (!validation.valid) {
      return c.json<ErrorResponse>({ status: 'error', message: `Invalid YAML: ${validation.message}` }, 400);
    }
    return c.json<RuleTestResponse>(testAutomodRules(body));
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message: `Rule test failed: ${msg}` }, 400);
  }
});

api.get('/byo-key/status', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }
  const configured = Boolean(await getSubredditGeminiApiKey(subredditName));
  return c.json<ByoKeyStatusResponse>({ type: 'byo-key-status', configured });
});

api.post('/byo-key', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }
  try {
    const modPermissionNames = await getCurrentUserModPermissionNames(subredditName);
    if (!canManageSubredditKey(modPermissionNames)) {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'Only moderators with Everything, Manage Settings, or Manage Wiki Pages permission can set the subreddit Gemini key.' },
        403
      );
    }

    const body = await c.req.json<SetByoKeyRequest>();
    await setSubredditGeminiApiKey(subredditName, body.apiKey);
    return c.json<SetByoKeyResponse>({ type: 'set-byo-key', configured: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message: `BYO key save failed: ${msg}` }, 400);
  }
});

api.delete('/byo-key', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }
  const modPermissionNames = await getCurrentUserModPermissionNames(subredditName);
  if (!canManageSubredditKey(modPermissionNames)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Only moderators with Everything, Manage Settings, or Manage Wiki Pages permission can remove the subreddit Gemini key.' },
      403
    );
  }

  await removeSubredditGeminiApiKey(subredditName);
  return c.json<SetByoKeyResponse>({ type: 'set-byo-key', configured: false });
});

api.post('/debug/reset-quotas', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }

  const debugToolsEnabled = await settings.get<boolean>('debugToolsEnabled');
  if (!debugToolsEnabled) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Debug tools are disabled.' }, 404);
  }

  const modPermissionNames = await getCurrentUserModPermissionNames(subredditName);
  if (!canManageSubredditKey(modPermissionNames)) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Only moderators with Everything, Manage Settings, or Manage Wiki Pages permission can reset demo quotas.' },
      403
    );
  }

  const quota = await resetDailyQuota(subredditName);
  return c.json<ResetQuotaResponse>({ type: 'reset-quotas', quota });
});

api.post('/privacy-ack', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }
  const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
  await redis.set(`privacy:acked:${subredditName}:${username}`, 'true');
  return c.json<PrivacyAckResponse>({ type: 'privacy-ack', success: true });
});

api.post('/generate', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }

  const body = await c.req.json<GenerateRequest>();
  const inputEstimate = estimateTokens(body.currentConfig + body.message);
  const geminiKey = await getGeminiApiKey(subredditName);

  const quota = await checkQuota(subredditName, 'generate', inputEstimate, geminiKey.source === 'subreddit');
  if (!quota.allowed) {
    return c.json<ErrorResponse>({ status: 'error', message: quota.reason }, 429);
  }

  try {
    const result = await generateRule(body.currentConfig, body.message, body.history, geminiKey.apiKey);
    if (geminiKey.source !== 'subreddit') {
      await incrementQuota(subredditName, 'generate');
    }
    await logUsage(subredditName, 'generate', result.inputTokens, result.outputTokens);
    return c.json<GenerateResponse>({
      type: 'generate',
      yaml: result.yaml ?? '',
      assistantMessage: result.text,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message: `Generate failed: ${msg}` }, 500);
  }
});

api.post('/explain', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }

  const body = await c.req.json<ExplainRequest>();
  const inputEstimate = estimateTokens(body.config);
  const geminiKey = await getGeminiApiKey(subredditName);

  const quota = await checkQuota(subredditName, 'explain', inputEstimate, geminiKey.source === 'subreddit');
  if (!quota.allowed) {
    return c.json<ErrorResponse>({ status: 'error', message: quota.reason }, 429);
  }

  try {
    const result = await explainConfig(body.config, geminiKey.apiKey);
    if (geminiKey.source !== 'subreddit') {
      await incrementQuota(subredditName, 'explain');
    }
    await logUsage(subredditName, 'explain', result.inputTokens, result.outputTokens);
    return c.json<ExplainResponse>({ type: 'explain', explanation: result.text });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message: `Explain failed: ${msg}` }, 500);
  }
});

api.post('/conflict', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }

  const body = await c.req.json<ConflictRequest>();
  const inputEstimate = estimateTokens(body.config);
  const conflictGate = await getConflictGateStatus();
  if (conflictGate.enabled && !conflictGate.hasAccess) {
    return c.json<ErrorResponse>(
      { status: 'error', message: `Conflict Check requires purchase${conflictGate.sku ? ` (${conflictGate.sku})` : ''}.` },
      402
    );
  }
  const geminiKey = await getGeminiApiKey(subredditName);

  const quota = await checkQuota(subredditName, 'conflict', inputEstimate, geminiKey.source === 'subreddit');
  if (!quota.allowed) {
    return c.json<ErrorResponse>({ status: 'error', message: quota.reason }, 429);
  }

  try {
    const result = await conflictCheck(body.config, geminiKey.apiKey);
    if (geminiKey.source !== 'subreddit') {
      await incrementQuota(subredditName, 'conflict');
    }
    await logUsage(subredditName, 'conflict', result.inputTokens, result.outputTokens);
    return c.json<ConflictResponse>({ type: 'conflict', report: result.text });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message: `Conflict check failed: ${msg}` }, 500);
  }
});

api.post('/save', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }

  const body = await c.req.json<SaveRequest>();

  try {
    const contentToValidate = body.appendMode
      ? `${(await getCurrent(subredditName)).trimEnd()}\n${body.content}`.trim()
      : body.content;
    const validation = validateAutomodYaml(contentToValidate);
    if (!validation.valid) {
      return c.json<ErrorResponse>({ status: 'error', message: `Invalid YAML: ${validation.message}` }, 400);
    }

    const expectedContent = body.appendMode
      ? await saveAppend(subredditName, body.content, body.summary)
      : await saveReplace(subredditName, body.content, body.summary);
    const savedContent = await getCurrent(subredditName);
    if (savedContent !== expectedContent) {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'Save verification failed: wiki content did not match submitted content' },
        500
      );
    }

    return c.json<SaveResponse>({
      type: 'save',
      success: true,
      verified: true,
      savedContent,
      message: 'Verified save',
      timestamp: Date.now(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const permissionHint = /permission|wiki|403|moderator/i.test(msg) ? `${wikiPermissionHelp()} ` : '';
    return c.json<ErrorResponse>({ status: 'error', message: `Save failed: ${permissionHint}${msg}` }, 500);
  }
});

api.post('/undo-last-save', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }

  try {
    const backup = await getLatestBackup(subredditName);
    if (backup === null) {
      return c.json<ErrorResponse>({ status: 'error', message: 'No ModScript backup is available to undo.' }, 404);
    }
    const backupValidation = validateAutomodYaml(backup);
    if (!backupValidation.valid) {
      return c.json<ErrorResponse>({ status: 'error', message: `Backup YAML is invalid: ${backupValidation.message}` }, 400);
    }

    const expectedContent = await restoreLatestBackup(subredditName);
    const restoredContent = await getCurrent(subredditName);
    if (restoredContent !== expectedContent) {
      return c.json<ErrorResponse>(
        { status: 'error', message: 'Undo verification failed: wiki content did not match backup content' },
        500
      );
    }

    return c.json<UndoLastSaveResponse>({
      type: 'undo-last-save',
      success: true,
      verified: true,
      restoredContent,
      message: 'Verified undo',
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message: `Undo failed: ${msg}` }, 500);
  }
});

api.get('/revisions', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }
  try {
    const revisions = await getRevisions(subredditName);
    return c.json<RevisionsResponse>({ type: 'revisions', revisions });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message: `Revisions failed: ${msg}` }, 500);
  }
});

api.post('/revert', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }
  const body = await c.req.json<RevertRequest>();
  try {
    const content = await revertTo(subredditName, body.revisionId);
    return c.json<RevertResponse>({ type: 'revert', success: true, content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message: `Revert failed: ${msg}` }, 500);
  }
});

api.get('/revision-content', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }
  const revisionId = c.req.query('id');
  if (!revisionId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing revision ID' }, 400);
  }
  try {
    const content = await getRevisionContent(subredditName, revisionId);
    return c.json<RevisionContentResponse>({ type: 'revision-content', content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message: `Revision content failed: ${msg}` }, 500);
  }
});

api.get('/template/:id', (c) => {
  const id = c.req.param('id');
  const template = getTemplate(id as Parameters<typeof getTemplate>[0]);
  if (!template) {
    return c.json<ErrorResponse>({ status: 'error', message: `Unknown template: ${id}` }, 404);
  }
  return c.json({ yaml: template.yaml });
});
