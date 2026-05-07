import { settings } from '@devvit/web/server';
import type { AppMode, ChatMessage } from '../../shared/api';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL_PRO = 'gemini-2.5-pro';
const MODEL_FLASH = 'gemini-2.5-flash';

// Set USE_MOCK=true in your environment during local dev to skip real API calls
const USE_MOCK = process.env['USE_MOCK'] === 'true';

type GeminiResponse = {
  yaml?: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
};

// --- Mock responses ---

const MOCK_GENERATE: GeminiResponse = {
  yaml: `---
# Generated rule (mock)
type: submission
title (includes, any, case-insensitive):
  - "spam"
  - "advertisement"
action: remove
action_reason: "Post removed by AutoModerator — possible spam."
`,
  text: "I've added a rule that removes submissions with spam or advertisement keywords in the title. The rule is case-insensitive and appended to your existing config.",
  inputTokens: 120,
  outputTokens: 80,
};

const MOCK_EXPLAIN: GeminiResponse = {
  text: `Here's a rule-by-rule breakdown of your AutoModerator config:

**Rule 1 — New account gate**
Removes submissions from accounts younger than 7 days with fewer than 10 comment karma. This blocks most throwaway spam accounts.

**Rule 2 — Spam phrase filter**
Removes posts whose titles contain known spam phrases (case-insensitive). Catches typical promotional content.

**Rule 3 — Flair requirement**
Removes posts that have no post flair set. Ensures all content is categorized for easier moderation.

*Note: This is a structural analysis only. Test any changes on a low-traffic post before relying on them.*`,
  inputTokens: 200,
  outputTokens: 150,
};

const MOCK_CONFLICT: GeminiResponse = {
  text: `**ModScript Conflict Check — Review Suggestions**

*This is a structural pattern analysis, not a runtime simulation. These are suggestions for human review, not predictions of which rules will fire.*

1. **Possible redundancy** — Rules 1 and 2 both target new accounts. Consider consolidating the \`account_age\` and \`comment_karma\` checks into a single rule to reduce maintenance overhead.

2. **Rule ordering** — The flair requirement (Rule 3) runs before the spam filter (Rule 2). Depending on your intent, you may want to check for spam first to avoid triggering a "missing flair" message on content you'd remove anyway.

3. **No issues found** with the remaining rules.

*Suggestion: Review rules 1–2 for consolidation opportunity.*`,
  inputTokens: 300,
  outputTokens: 200,
};

// --- Real Gemini call ---

type GeminiContent = {
  role: 'user' | 'model';
  parts: [{ text: string }];
};

const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [1000, 2000];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(
  model: string,
  systemInstruction: string,
  contents: GeminiContent[],
  apiKey: string
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents,
    generationConfig: { temperature: 0.4 },
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_DELAYS_MS[attempt - 1]!);
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        candidates: [{ content: { parts: [{ text: string }] } }];
        usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
      };
      return {
        text: data.candidates[0].content.parts[0].text,
        inputTokens: data.usageMetadata.promptTokenCount,
        outputTokens: data.usageMetadata.candidatesTokenCount,
      };
    }

    if (RETRYABLE_STATUSES.has(res.status)) {
      lastError =
        res.status === 429
          ? new Error('Gemini is rate-limited — please try again in a moment.')
          : new Error('Gemini is temporarily unavailable — please try again in a moment.');
      continue;
    }

    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  throw lastError ?? new Error('Gemini request failed after retries.');
}

function buildSystemPrompt(mode: AppMode, currentConfig: string): string {
  const base = `You are ModScript, an AI assistant embedded in Reddit's mod panel.
You help subreddit moderators manage their AutoModerator YAML configuration.
The current AutoModerator config for this subreddit is:

\`\`\`yaml
${currentConfig || '(empty — no rules yet)'}
\`\`\`

AutoModerator rules are YAML documents separated by "---". Each rule has a "type" field (submission, comment, link, etc.) and an "action" field. Keep rules valid and well-commented.`;

  if (mode === 'generate') {
    return `${base}

You are in GENERATE mode. The user will describe a moderation rule in plain English.
Respond with:
1. A brief plain-English confirmation of what rule you're adding (1–2 sentences).
2. The YAML block(s) to append, delimited by \`\`\`yaml and \`\`\`. Output ONLY the new rules to append, not the entire existing config.
Rules are APPEND-ONLY by default. Never rewrite the existing config unless the user explicitly says "rewrite" or "replace the whole config".`;
  }

  if (mode === 'explain') {
    return `${base}

You are in EXPLAIN mode. Provide a rule-by-rule plain English breakdown of the config above.
For each rule: name it, explain what it does and why someone would use it, and note any potential side-effects.
End with a note that this is structural analysis only and mods should test changes on a low-traffic post.`;
  }

  return `${base}

You are in CONFLICT CHECK mode. Analyse the config for:
- Duplicate or redundant rules that could be consolidated
- Rules in an order that might produce unexpected results
- Overly broad patterns that could catch legitimate posts
- Missing safeguards for common edge cases

Frame all output as "review suggestions" — never claim to predict runtime behaviour.
Begin your response with: "ModScript Conflict Check — Review Suggestions"`;
}

// --- Public API ---

export async function generateRule(
  currentConfig: string,
  userMessage: string,
  history: ChatMessage[]
): Promise<GeminiResponse> {
  if (USE_MOCK) return MOCK_GENERATE;

  const apiKey = (await settings.get('geminiApiKey')) as string;
  const systemPrompt = buildSystemPrompt('generate', currentConfig);

  const contents: GeminiContent[] = [
    ...history.slice(-6).map((m) => ({
      role: (m.role === 'user' ? 'user' : 'model') as 'user' | 'model',
      parts: [{ text: m.content }] as [{ text: string }],
    })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  const result = await callGemini(MODEL_PRO, systemPrompt, contents, apiKey);

  // Extract YAML block from the response
  const yamlMatch = result.text.match(/```yaml\n([\s\S]*?)```/);
  const yaml = yamlMatch ? yamlMatch[1] : '';
  const text = result.text.replace(/```yaml[\s\S]*?```/g, '').trim();

  return { yaml, text, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}

export async function explainConfig(currentConfig: string): Promise<GeminiResponse> {
  if (USE_MOCK) return MOCK_EXPLAIN;

  const apiKey = (await settings.get('geminiApiKey')) as string;
  const systemPrompt = buildSystemPrompt('explain', currentConfig);
  const contents: GeminiContent[] = [
    { role: 'user', parts: [{ text: 'Please explain my AutoModerator config.' }] },
  ];

  const result = await callGemini(MODEL_FLASH, systemPrompt, contents, apiKey);
  return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}

export async function conflictCheck(currentConfig: string): Promise<GeminiResponse> {
  if (USE_MOCK) return MOCK_CONFLICT;

  const apiKey = (await settings.get('geminiApiKey')) as string;
  const systemPrompt = buildSystemPrompt('conflict', currentConfig);
  const contents: GeminiContent[] = [
    { role: 'user', parts: [{ text: 'Please check my AutoModerator config for conflicts and issues.' }] },
  ];

  const result = await callGemini(MODEL_PRO, systemPrompt, contents, apiKey);
  return { text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}

export function estimateTokens(text: string): number {
  // Rough approximation: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}
