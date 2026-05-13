import { Hono } from 'hono';
import { context, reddit, redis } from '@devvit/web/server';
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
  RevisionsResponse,
  RevertRequest,
  RevertResponse,
  RevisionContentResponse,
  ErrorResponse,
  ValidateYamlRequest,
  ValidateYamlResponse,
  DemoConfigResponse,
} from '../../shared/api';
import { checkQuota, incrementQuota, logUsage, getQuotaStatus } from '../core/quota';
import { getCurrent, getCurrentWithStatus, saveAppend, saveReplace, getRevisions, revertTo, getRevisionContent } from '../core/wiki';
import { generateRule, explainConfig, conflictCheck, estimateTokens } from '../core/gemini';
import { getTemplate } from '../core/templates';
import { validateAutomodYaml } from '../core/yaml';
import { DEMO_AUTOMOD_CONFIG } from '../core/demo';

export const api = new Hono();

api.get('/init', async (c) => {
  const { postId, subredditName } = context;

  if (!postId || !subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing context' }, 400);
  }

  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const currentUser = await reddit.getCurrentUser();
    const [privacyRaw, currentWiki, quota, modPermissions] = await Promise.all([
      redis.get(`privacy:acked:${subredditName}:${username}`),
      getCurrentWithStatus(subredditName),
      getQuotaStatus(subredditName),
      currentUser?.getModPermissionsForSubreddit(subredditName) ?? Promise.resolve([]),
    ]);
    const modPermissionNames = modPermissions.map((permission) => String(permission));
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

  const quota = await checkQuota(subredditName, 'generate', inputEstimate);
  if (!quota.allowed) {
    return c.json<ErrorResponse>({ status: 'error', message: quota.reason }, 429);
  }

  try {
    const result = await generateRule(body.currentConfig, body.message, body.history);
    await incrementQuota(subredditName, 'generate');
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

  const quota = await checkQuota(subredditName, 'explain', inputEstimate);
  if (!quota.allowed) {
    return c.json<ErrorResponse>({ status: 'error', message: quota.reason }, 429);
  }

  try {
    const result = await explainConfig(body.config);
    await incrementQuota(subredditName, 'explain');
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

  const quota = await checkQuota(subredditName, 'conflict', inputEstimate);
  if (!quota.allowed) {
    return c.json<ErrorResponse>({ status: 'error', message: quota.reason }, 429);
  }

  try {
    const result = await conflictCheck(body.config);
    await incrementQuota(subredditName, 'conflict');
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

    if (body.appendMode) {
      await saveAppend(subredditName, body.content, body.summary);
    } else {
      await saveReplace(subredditName, body.content, body.summary);
    }
    return c.json<SaveResponse>({ type: 'save', success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message: `Save failed: ${msg}` }, 500);
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
