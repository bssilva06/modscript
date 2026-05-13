import yaml from 'js-yaml';
import type { RuleTestRequest, RuleTestResponse, RuleTestResult } from '../../shared/api';

type YamlRecord = Record<string, unknown>;

const AUTHOR_FIELDS = new Set(['account_age', 'combined_karma', 'comment_karma', 'link_karma']);
const SUPPORTED_ROOTS = new Set([
  'type',
  'action',
  'action_reason',
  'title',
  'body',
  'body+title',
  'url',
  'domain',
  'author',
  'is_flair_text',
]);

function isRecord(value: unknown): value is YamlRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keyBase(key: string): string {
  return key.replace(/\s*\([^)]*\)\s*/g, '').trim();
}

function keyOptions(key: string): string[] {
  const match = key.match(/\(([^)]*)\)/);
  const options = match?.[1];
  return options ? options.split(',').map((part) => part.trim().toLowerCase()) : [];
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => (typeof item === 'string' || typeof item === 'number' ? [String(item)] : []));
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  return [];
}

function sampleText(field: string, sample: RuleTestRequest['sample']): string {
  if (field === 'title') return sample.title;
  if (field === 'body') return sample.body;
  if (field === 'body+title') return `${sample.title}\n${sample.body}`;
  if (field === 'url') return sample.url;
  if (field === 'domain') return sample.domain;
  return '';
}

function textMatches(key: string, value: unknown, sample: RuleTestRequest['sample']): string | null {
  const base = keyBase(key);
  const options = keyOptions(key);
  const haystackRaw = sampleText(base, sample);
  const values = stringList(value);
  if (!haystackRaw || values.length === 0) return null;

  const caseInsensitive = options.includes('case-insensitive') || options.includes('regex');
  const haystack = caseInsensitive ? haystackRaw.toLowerCase() : haystackRaw;
  const mode = options.includes('regex') ? 'regex' : 'includes';

  for (const candidate of values) {
    if (mode === 'regex') {
      try {
        const regex = new RegExp(candidate, caseInsensitive ? 'i' : undefined);
        if (regex.test(haystackRaw)) return `${base} regex matched "${candidate}"`;
      } catch {
        return null;
      }
    } else {
      const needle = caseInsensitive ? candidate.toLowerCase() : candidate;
      if (haystack.includes(needle)) return `${base} includes "${candidate}"`;
    }
  }

  return null;
}

function numericCompare(condition: string, actual: number): boolean {
  const match = condition.match(/(<=|>=|<|>|=)?\s*(-?\d+)/);
  if (!match) return false;
  const operator = match[1] ?? '=';
  const expected = Number(match[2]);
  if (operator === '<') return actual < expected;
  if (operator === '<=') return actual <= expected;
  if (operator === '>') return actual > expected;
  if (operator === '>=') return actual >= expected;
  return actual === expected;
}

function authorValue(field: string, sample: RuleTestRequest['sample']): number {
  if (field === 'account_age') return sample.authorAgeDays;
  if (field === 'combined_karma') return sample.combinedKarma;
  if (field === 'comment_karma') return sample.commentKarma;
  if (field === 'link_karma') return sample.linkKarma;
  return 0;
}

function typeApplies(ruleType: unknown, sampleType: RuleTestRequest['sample']['type']): boolean {
  if (!ruleType || sampleType === 'any') return true;
  const raw = String(ruleType).toLowerCase();
  if (raw === 'any') return true;
  if (sampleType === 'submission') return raw.includes('submission') || raw.includes('link');
  return raw.includes('comment');
}

function evaluateRule(rule: YamlRecord, index: number, sample: RuleTestRequest['sample']): RuleTestResult {
  const name = typeof rule['#'] === 'string' ? rule['#'] : `Rule ${index + 1}`;
  const action = typeof rule.action === 'string' ? rule.action : 'none';
  const matchedConditions: string[] = [];
  const unsupportedConditions: string[] = [];
  let supportedChecks = 0;
  let supportedPassed = 0;

  if (!typeApplies(rule.type, sample.type)) {
    return { index, name, action, matched: false, matchedConditions: [], unsupportedConditions };
  }

  for (const [key, value] of Object.entries(rule)) {
    const base = keyBase(key);
    if (base === 'type' || base === 'action' || base === 'action_reason') continue;

    if (['title', 'body', 'body+title', 'url', 'domain'].includes(base)) {
      supportedChecks++;
      const matched = textMatches(key, value, sample);
      if (matched) {
        supportedPassed++;
        matchedConditions.push(matched);
      }
      continue;
    }

    if (base === 'author' && isRecord(value)) {
      for (const [authorKey, condition] of Object.entries(value)) {
        if (!AUTHOR_FIELDS.has(authorKey)) {
          unsupportedConditions.push(`author.${authorKey}`);
          continue;
        }
        supportedChecks++;
        if (numericCompare(String(condition), authorValue(authorKey, sample))) {
          supportedPassed++;
          matchedConditions.push(`author.${authorKey} matched ${String(condition)}`);
        }
      }
      continue;
    }

    if (base === 'is_flair_text') {
      supportedChecks++;
      const expected = String(value);
      const hasMatch = expected === '' ? sample.flairText.trim() === '' : sample.flairText === expected;
      if (hasMatch) {
        supportedPassed++;
        matchedConditions.push(expected === '' ? 'missing flair matched' : `flair matched "${expected}"`);
      }
      continue;
    }

    if (!SUPPORTED_ROOTS.has(base)) {
      unsupportedConditions.push(key);
    }
  }

  const matched = supportedChecks === 0 ? false : supportedPassed === supportedChecks;
  return { index, name, action, matched, matchedConditions, unsupportedConditions };
}

export function testAutomodRules(request: RuleTestRequest): RuleTestResponse {
  const docs = yaml.loadAll(request.config).filter(isRecord);
  const results = docs.map((doc, index) => evaluateRule(doc, index, request.sample));
  const matched = results.filter((result) => result.matched).length;
  const unsupported = results.reduce((total, result) => total + result.unsupportedConditions.length, 0);

  return {
    type: 'test-rules',
    results,
    summary: {
      matched,
      notMatched: results.length - matched,
      unsupported,
    },
    note: 'Best-effort deterministic check, not an AutoModerator runtime guarantee.',
  };
}
