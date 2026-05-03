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
  ErrorResponse,
} from '../../shared/api';
import { checkQuota, logUsage } from '../core/quota';
import { getCurrent, saveAppend, saveReplace } from '../core/wiki';
import { generateRule, explainConfig, conflictCheck, estimateTokens } from '../core/gemini';
import { getTemplate } from '../core/templates';

export const api = new Hono();

api.get('/init', async (c) => {
  const { postId, subredditName } = context;

  if (!postId || !subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing context' }, 400);
  }

  try {
    const [username, privacyRaw, currentConfig] = await Promise.all([
      reddit.getCurrentUsername(),
      redis.get(`privacy:acked:${subredditName}`),
      getCurrent(subredditName),
    ]);

    return c.json<InitResponse>({
      type: 'init',
      postId,
      subredditName,
      username: username ?? 'anonymous',
      privacyAcked: privacyRaw === 'true',
      currentConfig,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return c.json<ErrorResponse>({ status: 'error', message: `Init failed: ${msg}` }, 400);
  }
});

api.post('/privacy-ack', async (c) => {
  const { subredditName } = context;
  if (!subredditName) {
    return c.json<ErrorResponse>({ status: 'error', message: 'Missing subredditName' }, 400);
  }
  await redis.set(`privacy:acked:${subredditName}`, 'true');
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

api.get('/template/:id', (c) => {
  const id = c.req.param('id');
  const template = getTemplate(id as Parameters<typeof getTemplate>[0]);
  if (!template) {
    return c.json<ErrorResponse>({ status: 'error', message: `Unknown template: ${id}` }, 404);
  }
  return c.json({ yaml: template.yaml });
});
