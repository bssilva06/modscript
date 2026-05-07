/* eslint-disable react-refresh/only-export-components */
import './index.css';

import { StrictMode, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { createRoot } from 'react-dom/client';
import { showToast } from '@devvit/web/client';
import type {
  AppMode,
  ChatMessage,
  InitResponse,
  GenerateResponse,
  ExplainResponse,
  ConflictResponse,
  ErrorResponse,
  TemplateName,
  WikiRevision,
  RevisionsResponse,
  RevertRequest,
  RevertResponse,
} from '../shared/api';

// --- Types ---

type AppState =
  | { stage: 'loading' }
  | { stage: 'privacy'; postId: string; subredditName: string; username: string; currentConfig: string }
  | { stage: 'template'; postId: string; subredditName: string; username: string }
  | { stage: 'app'; postId: string; subredditName: string; username: string; initialConfig: string };

type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

// --- Diff utility ---

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

  let oi = 0;
  let ni = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    const o = oldLines[oi] ?? '';
    const n = newLines[ni] ?? '';
    if (oi >= oldLines.length) {
      result.push({ kind: 'added', text: n });
      ni++;
    } else if (ni >= newLines.length) {
      result.push({ kind: 'removed', text: o });
      oi++;
    } else if (o === n) {
      result.push({ kind: 'same', text: o });
      oi++;
      ni++;
    } else {
      const newHasOld = newLines.slice(ni).indexOf(o);
      const oldHasNew = oldLines.slice(oi).indexOf(n);
      if (newHasOld !== -1 && (oldHasNew === -1 || newHasOld <= oldHasNew)) {
        result.push({ kind: 'added', text: n });
        ni++;
      } else {
        result.push({ kind: 'removed', text: o });
        oi++;
      }
    }
  }
  return result;
}

// --- Sub-components ---

function PrivacyModal({ subredditName, onAck }: { subredditName: string; onAck: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleAck = async () => {
    setLoading(true);
    await fetch('/api/privacy-ack', { method: 'POST' });
    onAck();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6 flex flex-col gap-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Before you continue</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          <strong>ModScript</strong> uses Google Gemini to help you manage your AutoModerator
          configuration for <strong>r/{subredditName}</strong>.
        </p>
        <ul className="text-sm text-gray-600 dark:text-gray-300 list-disc pl-5 flex flex-col gap-1">
          <li>Your AutoModerator config is sent to Google Gemini for processing.</li>
          <li>No user data, post content, or personal information is shared.</li>
          <li>ModScript never saves your wiki or runs changes without your confirmation.</li>
          <li>AI-generated rules may have errors — always test before relying on them.</li>
        </ul>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          By continuing, you acknowledge this disclosure. This notice will not appear again for
          this subreddit.
        </p>
        <button
          onClick={handleAck}
          disabled={loading}
          className="mt-2 bg-[#ff4500] hover:bg-[#e03d00] text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:opacity-60"
        >
          {loading ? 'Saving…' : 'I understand — continue'}
        </button>
      </div>
    </div>
  );
}

const TEMPLATE_OPTIONS: { id: TemplateName; label: string; description: string }[] = [
  { id: 'general', label: 'General Community', description: 'Baseline spam and karma filters suitable for most subreddits.' },
  { id: 'gaming', label: 'Gaming', description: 'Flair requirements, low-effort title filter, and spam guards.' },
  { id: 'support', label: 'Support / Mental Health', description: 'Crisis-keyword alerting and anti-minimization rules.' },
  { id: 'news', label: 'News', description: 'Source attribution enforcement, link-karma gates, and auto-flair.' },
  { id: 'blank', label: 'Start blank', description: 'No starter rules — build from scratch.' },
];

function TemplatePicker({
  onSelect,
}: {
  onSelect: (id: TemplateName, yaml: string) => void;
}) {
  const [loading, setLoading] = useState<TemplateName | null>(null);

  const handleSelect = async (id: TemplateName) => {
    if (id === 'blank') {
      onSelect('blank', '');
      return;
    }
    setLoading(id);
    try {
      const res = await fetch(`/api/template/${id}`);
      const data = await res.json() as { yaml: string };
      onSelect(id, data.yaml);
    } catch {
      showToast({ text: 'Failed to load template', appearance: 'neutral' });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full p-6 flex flex-col gap-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Choose a starter template</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Pick a starting point for your AutoModerator config. You can customise everything after.
        </p>
        <div className="flex flex-col gap-2">
          {TEMPLATE_OPTIONS.map((t) => (
            <button
              key={t.id}
              onClick={() => handleSelect(t.id)}
              disabled={loading !== null}
              className="text-left p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-[#ff4500] hover:bg-orange-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-60"
            >
              <div className="font-semibold text-sm text-gray-900 dark:text-white">
                {loading === t.id ? 'Loading…' : t.label}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DiffPreviewModal({
  oldContent,
  newContent,
  appendMode,
  onConfirm,
  onCancel,
  saving,
}: {
  oldContent: string;
  newContent: string;
  appendMode: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const diff = computeDiff(oldContent, appendMode ? oldContent + newContent : newContent);
  const changes = diff.filter((l) => l.kind !== 'same').length;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full flex flex-col gap-4 p-6 max-h-[90vh]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">
            Preview changes ({changes} line{changes !== 1 ? 's' : ''} changed)
          </h2>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {appendMode
            ? 'New rules will be appended to your existing config.'
            : 'Warning: This will replace your entire AutoModerator config.'}
        </p>
        <div className="overflow-auto flex-1 font-mono text-xs bg-gray-50 dark:bg-gray-900 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
          {diff.map((line, i) => (
            <div
              key={i}
              className={
                line.kind === 'added'
                  ? 'bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-300'
                  : line.kind === 'removed'
                  ? 'bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-300 line-through'
                  : 'text-gray-600 dark:text-gray-400'
              }
            >
              <span className="select-none mr-2 opacity-50">
                {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
              </span>
              {line.text || ' '}
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-[#ff4500] hover:bg-[#e03d00] text-white text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving to wiki…' : 'Save to wiki'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RewriteConfirmModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full p-6 flex flex-col gap-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Replace entire config?</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          This will overwrite your entire AutoModerator configuration. A backup will be saved to Redis first, but your existing rules will be replaced.
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors"
          >
            Yes, replace config
          </button>
        </div>
      </div>
    </div>
  );
}

function VersionHistoryModal({
  flow,
  onRevert,
  onClose,
}: {
  flow: { step: 'loading' } | { step: 'view'; revisions: WikiRevision[] } | { step: 'reverting'; revisionId: string };
  onRevert: (id: string) => void;
  onClose: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [contentCache, setContentCache] = useState<Record<string, string | 'loading' | 'error'>>({});

  const toggleExpand = async (revId: string) => {
    if (expandedId === revId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(revId);
    if (contentCache[revId]) return;
    setContentCache((prev) => ({ ...prev, [revId]: 'loading' }));
    try {
      const res = await fetch(`/api/revision-content?id=${encodeURIComponent(revId)}`);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json() as { type: string; content: string };
      setContentCache((prev) => ({ ...prev, [revId]: data.content }));
    } catch {
      setContentCache((prev) => ({ ...prev, [revId]: 'error' }));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full p-6 flex flex-col gap-4 max-h-[85vh]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Version History</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {flow.step === 'loading' && (
          <div className="flex items-center justify-center py-8 text-gray-400 text-sm animate-pulse">
            Loading revisions…
          </div>
        )}

        {(flow.step === 'view' || flow.step === 'reverting') && (
          <>
            {flow.step === 'view' && flow.revisions.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                No revisions found. Save your config to create the first one.
              </p>
            )}
            <div className="overflow-y-auto flex-1 flex flex-col gap-2">
              {(flow.step === 'view' ? flow.revisions : []).map((rev) => {
                const isReverting = flow.step === 'reverting' && flow.revisionId === rev.id;
                const isExpanded = expandedId === rev.id;
                const cachedContent = contentCache[rev.id];
                return (
                  <div
                    key={rev.id}
                    className="flex flex-col rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 overflow-hidden"
                  >
                    <div className="flex items-start justify-between gap-3 p-3">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">
                          {new Date(rev.timestamp).toLocaleString()}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">by u/{rev.author}</span>
                        {rev.reason && (
                          <span className="text-xs text-gray-400 dark:text-gray-500 break-words">
                            {rev.reason}
                          </span>
                        )}
                      </div>
                      <div className="shrink-0 flex gap-1.5">
                        <button
                          onClick={() => void toggleExpand(rev.id)}
                          disabled={flow.step === 'reverting'}
                          className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-500 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-600 transition-colors disabled:opacity-40"
                        >
                          {isExpanded ? 'Hide' : 'View'}
                        </button>
                        <button
                          onClick={() => onRevert(rev.id)}
                          disabled={flow.step === 'reverting'}
                          className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-500 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-600 transition-colors disabled:opacity-40"
                        >
                          {isReverting ? 'Reverting…' : 'Revert'}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-gray-200 dark:border-gray-600">
                        {!cachedContent || cachedContent === 'loading' ? (
                          <div className="p-3 text-xs text-gray-400 animate-pulse">Loading…</div>
                        ) : cachedContent === 'error' ? (
                          <div className="p-3 text-xs text-red-500">Failed to load revision content.</div>
                        ) : cachedContent.trim() === '' ? (
                          <div className="p-3 text-xs text-gray-400 italic">Empty config at this revision.</div>
                        ) : (
                          <pre className="p-3 text-xs font-mono text-gray-800 dark:text-gray-100 overflow-auto max-h-72 whitespace-pre leading-relaxed">
                            {cachedContent}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- Mode badge colours ---

const modeBadge: Record<AppMode, string> = {
  generate: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  explain: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  conflict: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
};

const modeLabel: Record<AppMode, string> = {
  generate: 'Generate',
  explain: 'Explain',
  conflict: 'Conflict Check',
};

// --- Main app ---

function MainApp({
  subredditName,
  username,
  initialConfig,
}: {
  subredditName: string;
  username: string;
  initialConfig: string;
}) {
  const [mode, setMode] = useState<AppMode>('generate');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);

  // The config currently shown in the code panel (may have unsaved appended rules)
  const [workingConfig, setWorkingConfig] = useState(initialConfig);
  // The config last confirmed saved to wiki
  const [savedConfig, setSavedConfig] = useState(initialConfig);

  type SaveFlow =
    | null
    | { step: 'rewrite-confirm' }
    | { step: 'diff-preview'; appendMode: boolean; contentToSave: string; saving: boolean };

  type HistoryFlow =
    | { step: 'loading' }
    | { step: 'view'; revisions: WikiRevision[] }
    | { step: 'reverting'; revisionId: string };

  const [saveFlow, setSaveFlow] = useState<SaveFlow>(null);
  const [historyFlow, setHistoryFlow] = useState<HistoryFlow | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const pushMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');
    setThinking(true);

    const userMsg: ChatMessage = { role: 'user', content: text, mode, timestamp: Date.now() };
    pushMessage(userMsg);

    try {
      if (mode === 'generate') {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, currentConfig: workingConfig, history: messages.slice(-6) }),
        });
        if (!res.ok) {
          const err = await res.json() as ErrorResponse;
          pushMessage({ role: 'assistant', content: `Error: ${err.message}`, mode, timestamp: Date.now() });
          return;
        }
        const data = await res.json() as GenerateResponse;
        if (data.yaml) {
          setWorkingConfig((prev) => prev.trimEnd() + '\n' + data.yaml);
        }
        pushMessage({ role: 'assistant', content: data.assistantMessage, mode, timestamp: Date.now() });
      } else if (mode === 'explain') {
        const res = await fetch('/api/explain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: workingConfig }),
        });
        if (!res.ok) {
          const err = await res.json() as ErrorResponse;
          pushMessage({ role: 'assistant', content: `Error: ${err.message}`, mode, timestamp: Date.now() });
          return;
        }
        const data = await res.json() as ExplainResponse;
        pushMessage({ role: 'assistant', content: data.explanation, mode, timestamp: Date.now() });
      } else {
        const res = await fetch('/api/conflict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: workingConfig }),
        });
        if (!res.ok) {
          const err = await res.json() as ErrorResponse;
          pushMessage({ role: 'assistant', content: `Error: ${err.message}`, mode, timestamp: Date.now() });
          return;
        }
        const data = await res.json() as ConflictResponse;
        pushMessage({ role: 'assistant', content: data.report, mode, timestamp: Date.now() });
      }
    } catch (err) {
      pushMessage({ role: 'assistant', content: 'Network error — please try again.', mode, timestamp: Date.now() });
    } finally {
      setThinking(false);
    }
  }, [input, thinking, mode, workingConfig, messages, pushMessage]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleExplainClick = () => {
    setMode('explain');
    setInput('Explain my current AutoModerator config.');
  };

  const handleConflictClick = () => {
    setMode('conflict');
    setInput('Check my config for conflicts and issues.');
  };

  const handleSaveClick = () => {
    const hasNewContent = workingConfig !== savedConfig;
    if (!hasNewContent) {
      showToast({ text: 'No unsaved changes', appearance: 'neutral' });
      return;
    }
    setSaveFlow({ step: 'diff-preview', appendMode: true, contentToSave: workingConfig, saving: false });
  };

  const handleReplaceClick = () => {
    setSaveFlow({ step: 'rewrite-confirm' });
  };

  const confirmRewrite = () => {
    setSaveFlow({ step: 'diff-preview', appendMode: false, contentToSave: workingConfig, saving: false });
  };

  const confirmSave = async () => {
    if (!saveFlow || saveFlow.step !== 'diff-preview') return;
    setSaveFlow({ ...saveFlow, saving: true });

    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: saveFlow.contentToSave,
        appendMode: saveFlow.appendMode,
        summary: messages.at(-2)?.content.slice(0, 80) ?? 'manual save',
      }),
    });

    if (res.ok) {
      setSavedConfig(saveFlow.contentToSave);
      setSaveFlow(null);
      showToast({ text: 'Saved to wiki', appearance: 'success' });
    } else {
      const err = await res.json() as ErrorResponse;
      setSaveFlow({ ...saveFlow, saving: false });
      showToast({ text: `Save failed: ${err.message}`, appearance: 'neutral' });
    }
  };

  const openHistory = async () => {
    setHistoryFlow({ step: 'loading' });
    const res = await fetch('/api/revisions');
    if (!res.ok) {
      showToast({ text: 'Failed to load history', appearance: 'neutral' });
      setHistoryFlow(null);
      return;
    }
    const data = await res.json() as RevisionsResponse;
    setHistoryFlow({ step: 'view', revisions: data.revisions });
  };

  const handleRevert = async (revisionId: string) => {
    setHistoryFlow({ step: 'reverting', revisionId });
    const res = await fetch('/api/revert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisionId } satisfies RevertRequest),
    });
    if (!res.ok) {
      showToast({ text: 'Revert failed', appearance: 'neutral' });
      setHistoryFlow(null);
      return;
    }
    const data = await res.json() as RevertResponse;
    setWorkingConfig(data.content);
    setSavedConfig(data.content);
    setHistoryFlow(null);
    showToast({ text: 'Reverted successfully', appearance: 'success' });
  };

  const hasUnsavedChanges = workingConfig !== savedConfig;

  const placeholder: Record<AppMode, string> = {
    generate: 'Describe a rule to add, e.g. "Remove posts from accounts under 7 days old"',
    explain: 'Ask about a specific rule, or press Enter to explain the full config',
    conflict: 'Press Enter to run a conflict check on the current config',
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Left: Chat panel */}
      <div className="flex flex-col w-1/2 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        {/* Header */}
        <div className="flex flex-col gap-2 p-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              r/{subredditName}
            </span>
            <span className="text-xs text-gray-400">u/{username}</span>
          </div>
          {/* Mode toggle */}
          <div className="flex gap-1">
            {(['generate', 'explain', 'conflict'] as AppMode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  if (m === 'explain') handleExplainClick();
                  if (m === 'conflict') handleConflictClick();
                }}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                  mode === m
                    ? modeBadge[m] + ' font-semibold'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {modeLabel[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-center text-gray-400 dark:text-gray-500 text-sm px-6">
              <div className="text-3xl">⚙️</div>
              <p className="font-medium">ModScript</p>
              <p>
                {mode === 'generate'
                  ? 'Describe a moderation rule in plain English and I\'ll generate the AutoMod YAML.'
                  : mode === 'explain'
                  ? 'I\'ll give you a plain English breakdown of each rule in your config.'
                  : 'I\'ll analyse your config for structural issues and suggest improvements.'}
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`group flex flex-col gap-1 max-w-[85%] ${msg.role === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
            >
              <div
                className={`px-3 py-2 rounded-xl text-sm ${
                  msg.role === 'user'
                    ? 'bg-[#ff4500] text-white rounded-br-sm whitespace-pre-wrap'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-sm'
                }`}
              >
                {msg.role === 'user' ? (
                  msg.content
                ) : (
                  <ReactMarkdown
                    components={{
                      h1: ({ children }) => <h1 className="text-base font-bold mt-2 mb-1">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-sm font-bold mt-2 mb-1">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-semibold mt-1 mb-0.5">{children}</h3>,
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      em: ({ children }) => <em className="italic">{children}</em>,
                      ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
                      li: ({ children }) => <li className="text-sm">{children}</li>,
                      code: ({ children, className }) =>
                        className ? (
                          <code className="block bg-gray-200 dark:bg-gray-800 rounded p-2 text-xs font-mono whitespace-pre-wrap mt-1 mb-2 overflow-x-auto">{children}</code>
                        ) : (
                          <code className="bg-gray-200 dark:bg-gray-800 rounded px-1 text-xs font-mono">{children}</code>
                        ),
                      pre: ({ children }) => <pre className="bg-gray-200 dark:bg-gray-800 rounded p-2 text-xs font-mono whitespace-pre-wrap mt-1 mb-2 overflow-x-auto">{children}</pre>,
                      blockquote: ({ children }) => <blockquote className="border-l-2 border-gray-400 pl-2 italic text-gray-600 dark:text-gray-400 my-1">{children}</blockquote>,
                      hr: () => <hr className="border-gray-300 dark:border-gray-600 my-2" />,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                )}
              </div>
              <div className={`flex items-center gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <span className={`text-xs px-1 ${modeBadge[msg.mode]} rounded-full`}>
                  {modeLabel[msg.mode]}
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {msg.role === 'assistant' && (
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(msg.content);
                      showToast({ text: 'Copied', appearance: 'success' });
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    Copy
                  </button>
                )}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="self-start bg-gray-100 dark:bg-gray-700 px-4 py-3 rounded-xl rounded-bl-sm">
              <div className="flex gap-1.5 items-center">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-gray-200 dark:border-gray-700 flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder[mode]}
            rows={2}
            className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm p-2 focus:outline-none focus:ring-2 focus:ring-[#ff4500] text-gray-900 dark:text-gray-100 placeholder-gray-400"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || thinking}
            className="bg-[#ff4500] hover:bg-[#e03d00] text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-40 shrink-0"
          >
            Send
          </button>
        </div>
      </div>

      {/* Right: Code panel */}
      <div className="flex flex-col w-1/2 bg-gray-50 dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              config/automoderator
            </span>
            {hasUnsavedChanges && (
              <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 px-2 py-0.5 rounded-full font-medium">
                unsaved
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void openHistory()}
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              History
            </button>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(workingConfig);
                showToast({ text: 'Config copied', appearance: 'success' });
              }}
              disabled={!workingConfig.trim()}
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-40"
            >
              Copy
            </button>
            <button
              onClick={handleReplaceClick}
              className="text-xs px-2 py-1 rounded border border-red-300 text-red-600 dark:border-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              Replace all
            </button>
            <button
              onClick={handleSaveClick}
              disabled={!hasUnsavedChanges}
              className="text-xs px-3 py-1 rounded bg-[#ff4500] hover:bg-[#e03d00] text-white font-semibold transition-colors disabled:opacity-40"
            >
              Save to wiki
            </button>
          </div>
        </div>

        {/* YAML viewer */}
        <div className="flex-1 overflow-auto p-4">
          {workingConfig.trim() ? (
            <div className="font-mono text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
              {workingConfig.split('\n').map((line, i) => (
                <div key={i} className="flex">
                  <span className="select-none text-right text-gray-400 dark:text-gray-600 mr-4 w-7 shrink-0 text-xs pt-px">
                    {i + 1}
                  </span>
                  <span className="whitespace-pre-wrap break-words min-w-0">{line || ' '}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm text-center px-6">
              <div className="flex flex-col items-center gap-2">
                <div className="text-2xl">📄</div>
                <p>No AutoModerator rules yet.</p>
                <p className="text-xs">Use Generate mode to add your first rule.</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer note */}
        <div className="p-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 text-center bg-white dark:bg-gray-800">
          AI-generated YAML — test on a low-traffic post before relying on new rules.
        </div>
      </div>

      {/* Modals */}
      {saveFlow?.step === 'rewrite-confirm' && (
        <RewriteConfirmModal onConfirm={confirmRewrite} onCancel={() => setSaveFlow(null)} />
      )}
      {saveFlow?.step === 'diff-preview' && (
        <DiffPreviewModal
          oldContent={savedConfig}
          newContent={saveFlow.appendMode ? workingConfig.slice(savedConfig.length) : workingConfig}
          appendMode={saveFlow.appendMode}
          onConfirm={() => void confirmSave()}
          onCancel={() => setSaveFlow(null)}
          saving={saveFlow.saving}
        />
      )}
      {historyFlow !== null && (
        <VersionHistoryModal
          flow={historyFlow}
          onRevert={(id) => void handleRevert(id)}
          onClose={() => setHistoryFlow(null)}
        />
      )}
    </div>
  );
}

// --- Root app with init + flow ---

function App() {
  const [state, setState] = useState<AppState>({ stage: 'loading' });

  useEffect(() => {
    const init = async () => {
      try {
        const res = await fetch('/api/init');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as InitResponse;
        if (data.type !== 'init') throw new Error('Unexpected response');

        if (!data.privacyAcked) {
          setState({
            stage: 'privacy',
            postId: data.postId,
            subredditName: data.subredditName,
            username: data.username,
            currentConfig: data.currentConfig,
          });
        } else if (!data.currentConfig.trim()) {
          setState({
            stage: 'template',
            postId: data.postId,
            subredditName: data.subredditName,
            username: data.username,
          });
        } else {
          setState({
            stage: 'app',
            postId: data.postId,
            subredditName: data.subredditName,
            username: data.username,
            initialConfig: data.currentConfig,
          });
        }
      } catch (err) {
        console.error('Init failed', err);
        setState({ stage: 'loading' }); // stay on loading; could add error state
      }
    };
    void init();
  }, []);

  if (state.stage === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900 text-gray-500 dark:text-gray-400">
        <div className="flex flex-col items-center gap-3">
          <div className="text-2xl animate-spin">⚙️</div>
          <p className="text-sm">Loading ModScript…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {state.stage === 'privacy' && (
        <>
          <MainApp
            subredditName={state.subredditName}
            username={state.username}
            initialConfig={state.currentConfig}
          />
          <PrivacyModal
            subredditName={state.subredditName}
            onAck={() => {
              if (!state.currentConfig.trim()) {
                setState({ stage: 'template', postId: state.postId, subredditName: state.subredditName, username: state.username });
              } else {
                setState({ stage: 'app', postId: state.postId, subredditName: state.subredditName, username: state.username, initialConfig: state.currentConfig });
              }
            }}
          />
        </>
      )}
      {state.stage === 'template' && (
        <>
          <MainApp subredditName={state.subredditName} username={state.username} initialConfig="" />
          <TemplatePicker
            onSelect={(_, yaml) =>
              setState({ stage: 'app', postId: state.postId, subredditName: state.subredditName, username: state.username, initialConfig: yaml })
            }
          />
        </>
      )}
      {state.stage === 'app' && (
        <MainApp
          subredditName={state.subredditName}
          username={state.username}
          initialConfig={state.initialConfig}
        />
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
