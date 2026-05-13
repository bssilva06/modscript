/* eslint-disable react-refresh/only-export-components */
import './index.css';

import { StrictMode, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { highlightLine } from './yamlHighlight';
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
  QuotaModeStatus,
} from '../shared/api';

// --- Types ---

type QuotaState = Record<AppMode, QuotaModeStatus>;

const DEFAULT_QUOTA: QuotaState = {
  generate: { used: 0, cap: 50 },
  explain:  { used: 0, cap: 50 },
  conflict: { used: 0, cap: 5  },
};

type AppState =
  | { stage: 'loading' }
  | { stage: 'privacy'; postId: string; subredditName: string; username: string; currentConfig: string; quota: QuotaState }
  | { stage: 'template'; postId: string; subredditName: string; username: string }
  | { stage: 'app'; postId: string; subredditName: string; username: string; initialConfig: string; quota: QuotaState };

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

// --- Design tokens ---

const modeAccentBorder: Record<AppMode, string> = {
  generate: 'border-l-blue-400',
  explain: 'border-l-purple-400',
  conflict: 'border-l-amber-400',
};

const modeBadge: Record<AppMode, string> = {
  generate: 'text-blue-400 bg-blue-400/10',
  explain: 'text-purple-400 bg-purple-400/10',
  conflict: 'text-amber-400 bg-amber-400/10',
};

const modeLabel: Record<AppMode, string> = {
  generate: 'Generate',
  explain: 'Explain',
  conflict: 'Conflict',
};

// --- Shared modal shell ---

function ModalShell({ children, width = 'max-w-md' }: { children: React.ReactNode; width?: string }) {
  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4">
      <div className={`bg-white dark:bg-[#16161e] border border-[#e0e0e0] dark:border-[#252535] w-full ${width} flex flex-col`}>
        {children}
      </div>
    </div>
  );
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
    <ModalShell>
      <div className="px-5 pt-5 pb-4 border-b border-[#e0e0e0] dark:border-[#252535]">
        <div className="text-[10px] font-mono text-[#888] uppercase tracking-widest mb-1">privacy disclosure</div>
        <h2 className="text-base font-mono font-bold text-gray-900 dark:text-[#e0e0e8]">Before you continue</h2>
      </div>
      <div className="px-5 py-4 flex flex-col gap-3">
        <p className="text-sm text-gray-600 dark:text-[#9090a0] leading-relaxed">
          <span className="font-semibold text-gray-900 dark:text-[#e0e0e8]">ModScript</span> uses Google Gemini to help you manage your AutoModerator
          config for <span className="font-semibold text-[#ff4500]">r/{subredditName}</span>.
        </p>
        <div className="bg-[#f8f8f8] dark:bg-[#0d0d12] border border-[#e0e0e0] dark:border-[#1e1e28] p-3 font-mono text-xs space-y-1.5">
          {[
            'Your AutoMod config is sent to Google Gemini.',
            'No user data or post content is shared.',
            'Changes only apply after your confirmation.',
            'AI-generated rules may have errors — test first.',
          ].map((item) => (
            <div key={item} className="flex gap-2 text-gray-600 dark:text-[#6a6a7a]">
              <span className="text-[#ff4500] shrink-0">▶</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 dark:text-[#4a4a5a]">
          This notice will not appear again for this subreddit.
        </p>
      </div>
      <div className="px-5 pb-5">
        <button
          onClick={handleAck}
          disabled={loading}
          className="w-full bg-[#ff4500] hover:bg-[#e03d00] text-white font-mono text-xs py-2.5 tracking-widest uppercase transition-colors disabled:opacity-50"
        >
          {loading ? 'saving…' : 'I understand — continue'}
        </button>
      </div>
    </ModalShell>
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
    <ModalShell width="max-w-lg">
      <div className="px-5 pt-5 pb-4 border-b border-[#e0e0e0] dark:border-[#252535]">
        <div className="text-[10px] font-mono text-[#888] uppercase tracking-widest mb-1">setup</div>
        <h2 className="text-base font-mono font-bold text-gray-900 dark:text-[#e0e0e8]">Choose a starter template</h2>
        <p className="text-xs text-gray-500 dark:text-[#6a6a7a] mt-1">
          Pick a starting point. You can customise everything after.
        </p>
      </div>
      <div className="p-4 flex flex-col gap-2">
        {TEMPLATE_OPTIONS.map((t) => (
          <button
            key={t.id}
            onClick={() => handleSelect(t.id)}
            disabled={loading !== null}
            className="text-left p-3 border border-[#e0e0e0] dark:border-[#252535] hover:border-[#ff4500] dark:hover:border-[#ff4500] hover:bg-[#fff8f5] dark:hover:bg-[#1a1008] transition-colors disabled:opacity-60 group"
          >
            <div className="flex items-center gap-2">
              <span className="text-[#ff4500] opacity-0 group-hover:opacity-100 text-xs transition-opacity font-mono">▶</span>
              <div className="font-mono text-sm font-semibold text-gray-900 dark:text-[#e0e0e8]">
                {loading === t.id ? 'loading…' : t.label}
              </div>
            </div>
            <div className="text-xs text-gray-500 dark:text-[#6a6a7a] mt-1 ml-4">{t.description}</div>
          </button>
        ))}
      </div>
    </ModalShell>
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
    <ModalShell width="max-w-2xl">
      <div className="px-5 pt-5 pb-4 border-b border-[#e0e0e0] dark:border-[#252535] flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono text-[#888] uppercase tracking-widest mb-1">diff preview</div>
          <h2 className="text-base font-mono font-bold text-gray-900 dark:text-[#e0e0e8]">
            {changes} line{changes !== 1 ? 's' : ''} changed
          </h2>
        </div>
        <button
          onClick={onCancel}
          className="font-mono text-xs text-[#888] hover:text-gray-900 dark:hover:text-[#e0e0e8] border border-transparent hover:border-[#e0e0e0] dark:hover:border-[#252535] px-2 py-1 transition-colors"
        >
          ✕ close
        </button>
      </div>
      {!appendMode && (
        <div className="mx-5 mt-4 px-3 py-2 border border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400 text-xs font-mono">
          ⚠ This will replace your entire AutoModerator config.
        </div>
      )}
      <div className="mx-5 my-4 flex-1 overflow-auto font-mono text-xs bg-[#0a0a0e] border border-[#1e1e28] max-h-[50vh]">
        {diff.map((line, i) => (
          <div
            key={i}
            className={
              line.kind === 'added'
                ? 'bg-[#0d2010] text-[#4ade80]'
                : line.kind === 'removed'
                ? 'bg-[#200d0d] text-[#f87171] line-through'
                : 'text-[#3a3a4a]'
            }
          >
            <span className="select-none inline-block w-5 text-center opacity-60 border-r border-[#1e1e28] mr-3">
              {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '}
            </span>
            {line.text || ' '}
          </div>
        ))}
      </div>
      <div className="px-5 pb-5 flex gap-2 justify-end border-t border-[#e0e0e0] dark:border-[#252535] pt-4">
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 border border-[#e0e0e0] dark:border-[#252535] text-xs font-mono text-gray-600 dark:text-[#9090a0] hover:bg-[#f5f5f5] dark:hover:bg-[#1a1a22] transition-colors disabled:opacity-50"
        >
          cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={saving}
          className="px-4 py-2 bg-[#ff4500] hover:bg-[#e03d00] text-white text-xs font-mono tracking-wider uppercase transition-colors disabled:opacity-50"
        >
          {saving ? 'saving…' : 'save to wiki'}
        </button>
      </div>
    </ModalShell>
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
    <ModalShell width="max-w-sm">
      <div className="px-5 pt-5 pb-4 border-b border-[#e0e0e0] dark:border-[#252535]">
        <div className="text-[10px] font-mono text-red-500 uppercase tracking-widest mb-1">destructive action</div>
        <h2 className="text-base font-mono font-bold text-gray-900 dark:text-[#e0e0e8]">Replace entire config?</h2>
      </div>
      <div className="px-5 py-4">
        <p className="text-sm text-gray-600 dark:text-[#9090a0] leading-relaxed">
          This will overwrite your entire AutoModerator configuration. A Redis backup will be saved first.
        </p>
      </div>
      <div className="px-5 pb-5 flex gap-2 justify-end border-t border-[#e0e0e0] dark:border-[#252535] pt-4">
        <button
          onClick={onCancel}
          className="px-4 py-2 border border-[#e0e0e0] dark:border-[#252535] text-xs font-mono text-gray-600 dark:text-[#9090a0] hover:bg-[#f5f5f5] dark:hover:bg-[#1a1a22] transition-colors"
        >
          cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 border border-red-500 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white text-xs font-mono tracking-wider uppercase transition-colors"
        >
          yes, replace config
        </button>
      </div>
    </ModalShell>
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
    <ModalShell width="max-w-2xl">
      <div className="px-5 pt-5 pb-4 border-b border-[#e0e0e0] dark:border-[#252535] flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono text-[#888] uppercase tracking-widest mb-1">wiki</div>
          <h2 className="text-base font-mono font-bold text-gray-900 dark:text-[#e0e0e8]">Version History</h2>
        </div>
        <button
          onClick={onClose}
          className="font-mono text-xs text-[#888] hover:text-gray-900 dark:hover:text-[#e0e0e8] border border-transparent hover:border-[#e0e0e0] dark:hover:border-[#252535] px-2 py-1 transition-colors"
        >
          ✕ close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto max-h-[65vh] p-4 flex flex-col gap-2">
        {flow.step === 'loading' && (
          <div className="flex items-center justify-center py-12 font-mono text-xs text-[#555]">
            <span className="animate-pulse text-[#ff4500] mr-2">▊</span>
            loading revisions…
          </div>
        )}

        {(flow.step === 'view' || flow.step === 'reverting') && (
          <>
            {flow.step === 'view' && flow.revisions.length === 0 && (
              <div className="text-center py-12 font-mono text-xs text-[#444]">
                <div className="text-[#2a2a35] mb-2">no revisions found</div>
                <div className="text-[#333]">save your config to create the first one</div>
              </div>
            )}
            {(flow.step === 'view' ? flow.revisions : []).map((rev) => {
              const isReverting = flow.step === 'reverting' && flow.revisionId === rev.id;
              const isExpanded = expandedId === rev.id;
              const cachedContent = contentCache[rev.id];
              return (
                <div
                  key={rev.id}
                  className="border border-[#e0e0e0] dark:border-[#252535] hover:border-[#ff4500]/30 dark:hover:border-[#ff4500]/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3 p-3">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-xs font-mono font-medium text-gray-700 dark:text-[#c0c0c8]">
                        {new Date(rev.timestamp).toLocaleString()}
                      </span>
                      <span className="text-[11px] font-mono text-[#888]">u/{rev.author}</span>
                      {rev.reason && (
                        <span className="text-[11px] text-gray-400 dark:text-[#555] break-words mt-0.5 italic">
                          {rev.reason}
                        </span>
                      )}
                    </div>
                    <div className="shrink-0 flex gap-1">
                      <button
                        onClick={() => void toggleExpand(rev.id)}
                        disabled={flow.step === 'reverting'}
                        className="text-[10px] font-mono px-2.5 py-1 border border-[#e0e0e0] dark:border-[#252535] text-gray-500 dark:text-[#666] hover:border-[#ff4500]/50 hover:text-[#ff4500] transition-colors disabled:opacity-40 uppercase tracking-wider"
                      >
                        {isExpanded ? 'hide' : 'view'}
                      </button>
                      <button
                        onClick={() => onRevert(rev.id)}
                        disabled={flow.step === 'reverting'}
                        className="text-[10px] font-mono px-2.5 py-1 border border-[#e0e0e0] dark:border-[#252535] text-gray-500 dark:text-[#666] hover:border-[#ff4500]/50 hover:text-[#ff4500] transition-colors disabled:opacity-40 uppercase tracking-wider"
                      >
                        {isReverting ? 'reverting…' : 'revert'}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-[#e0e0e0] dark:border-[#252535] bg-[#0a0a0e]">
                      {!cachedContent || cachedContent === 'loading' ? (
                        <div className="p-3 text-[11px] font-mono text-[#555] animate-pulse">loading…</div>
                      ) : cachedContent === 'error' ? (
                        <div className="p-3 text-[11px] font-mono text-red-400">failed to load revision content.</div>
                      ) : cachedContent.trim() === '' ? (
                        <div className="p-3 text-[11px] font-mono text-[#444] italic">empty config at this revision.</div>
                      ) : (
                        <pre className="p-3 text-[11px] font-mono text-[#9090a0] overflow-auto max-h-64 whitespace-pre leading-relaxed">
                          {cachedContent}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </ModalShell>
  );
}

// --- Main app ---

function MainApp({
  subredditName,
  username,
  initialConfig,
  initialQuota,
}: {
  subredditName: string;
  username: string;
  initialConfig: string;
  initialQuota: QuotaState;
}) {
  const [mode, setMode] = useState<AppMode>('generate');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);

  const [workingConfig, setWorkingConfig] = useState(initialConfig);
  const [savedConfig, setSavedConfig] = useState(initialConfig);

  type SaveFlow =
    | null
    | { step: 'rewrite-confirm' }
    | { step: 'diff-preview'; appendMode: boolean; contentToSave: string; saving: boolean };

  type HistoryFlow =
    | { step: 'loading' }
    | { step: 'view'; revisions: WikiRevision[] }
    | { step: 'reverting'; revisionId: string };

  const [quota, setQuota] = useState<QuotaState>(initialQuota);
  const [saveFlow, setSaveFlow] = useState<SaveFlow>(null);
  const [historyFlow, setHistoryFlow] = useState<HistoryFlow | null>(null);
  const [isEditing, setIsEditing] = useState(false);
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
        setQuota((q) => ({ ...q, [mode]: { ...q[mode], used: Math.min(q[mode].used + 1, q[mode].cap) } }));
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
        setQuota((q) => ({ ...q, [mode]: { ...q[mode], used: Math.min(q[mode].used + 1, q[mode].cap) } }));
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
        setQuota((q) => ({ ...q, [mode]: { ...q[mode], used: Math.min(q[mode].used + 1, q[mode].cap) } }));
      }
    } catch {
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
    const newContent = workingConfig.slice(savedConfig.length).trim();
    setSaveFlow({ step: 'diff-preview', appendMode: false, contentToSave: newContent, saving: false });
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
  const quotaPct = Math.min((quota[mode].used / quota[mode].cap) * 100, 100);
  const quotaExhausted = quota[mode].used >= quota[mode].cap;

  const placeholder: Record<AppMode, string> = {
    generate: 'Describe a rule, e.g. "Remove posts from accounts under 7 days old"',
    explain: 'Ask about a specific rule, or press Enter to explain the full config',
    conflict: 'Press Enter to run a conflict check on the current config',
  };

  const emptyStateText: Record<AppMode, string[]> = {
    generate: ["describe a rule in plain english", "and i'll write the yaml for you."],
    explain: ["i'll give you a plain english", "breakdown of each rule in your config."],
    conflict: ["i'll audit your config for", "conflicts and redundancies."],
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0a0e] text-gray-900 dark:text-gray-100">

      {/* Left: Chat panel */}
      <div className="flex flex-col w-1/2 border-r border-[#e0e0e0] dark:border-[#1e1e28] bg-white dark:bg-[#13131a]">

        <div className="border-b border-[#e0e0e0] dark:border-[#1e1e28]">
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <span className="font-mono text-xs font-semibold text-[#ff4500] tracking-wide">
              r/{subredditName}
            </span>
            <span className="font-mono text-[10px] text-[#888]">u/{username}</span>
          </div>

          <div className="flex border-b border-[#e0e0e0] dark:border-[#1e1e28]">
            {(['generate', 'explain', 'conflict'] as AppMode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  if (m === 'explain') handleExplainClick();
                  if (m === 'conflict') handleConflictClick();
                }}
                style={mode === m ? { borderBottomColor: '#ff4500' } : {}}
                className={`px-4 py-2.5 text-[11px] font-mono uppercase tracking-widest border-b-2 -mb-px transition-colors ${
                  mode === m
                    ? 'text-[#ff4500]'
                    : 'border-b-transparent text-[#888] hover:text-gray-700 dark:hover:text-[#bbb]'
                }`}
              >
                {modeLabel[m]}
              </button>
            ))}
          </div>

          <div className="px-4 py-2">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-[10px] font-mono text-[#aaa] dark:text-[#555] uppercase tracking-wider">
                {modeLabel[mode]} quota
              </span>
              <span className={`text-[10px] font-mono ${quotaExhausted ? 'text-red-400' : 'text-[#aaa] dark:text-[#555]'}`}>
                {quota[mode].used} / {quota[mode].cap}
              </span>
            </div>
            <div className="h-[2px] bg-[#e5e5e5] dark:bg-[#252530] overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${quotaExhausted ? 'bg-red-500' : 'bg-[#ff4500]'}`}
                style={{ width: `${quotaPct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="font-mono text-left">
                <div className="text-[#d0d0d0] dark:text-[#252535] text-[11px] mb-2 select-none">
                  {String.fromCharCode(9484)}{String.fromCharCode(9472)} modscript {String.fromCharCode(9472).repeat(28)}{String.fromCharCode(9488)}
                </div>
                <div className="px-4 space-y-1">
                  <div className="text-[10px] text-[#bbb] dark:text-[#3a3a4a]">$ mode: {mode}</div>
                  <div className="text-[#d0d0d0] dark:text-[#1e1e28] text-[10px] select-none">{String.fromCharCode(9472).repeat(36)}</div>
                  <div className="text-[#ff4500]/40 text-[10px] leading-relaxed">
                    {emptyStateText[mode][0]}<br />{emptyStateText[mode][1]}
                  </div>
                </div>
                <div className="text-[#d0d0d0] dark:text-[#252535] text-[11px] mt-2 select-none">
                  {String.fromCharCode(9492)}{String.fromCharCode(9472).repeat(36)}{String.fromCharCode(9496)}
                </div>
                <div className="text-[10px] font-mono mt-2 px-1 text-[#bbb] dark:text-[#444]">
                  ready<span className="animate-pulse text-[#ff4500]">{String.fromCharCode(9608)}</span>
                </div>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`group flex flex-col gap-1 max-w-[86%] ${msg.role === 'user' ? 'self-end items-end' : 'self-start items-start'}`}
            >
              {msg.role === 'user' ? (
                <div className="bg-[#ff4500] text-white text-sm px-3 py-2 rounded-sm rounded-br-none leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </div>
              ) : (
                <div className={`bg-[#f6f6f8] dark:bg-[#1a1a22] text-sm px-3 py-2.5 rounded-sm border-l-2 ${modeAccentBorder[msg.mode]} text-gray-800 dark:text-[#d0d0d8] leading-relaxed`}>
                  <ReactMarkdown
                    components={{
                      h1: ({ children }) => <h1 className="text-sm font-bold mt-2 mb-1 font-mono">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-xs font-bold mt-2 mb-1 font-mono text-[#ff4500]">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-xs font-semibold mt-1 mb-0.5 font-mono">{children}</h3>,
                      p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      em: ({ children }) => <em className="italic">{children}</em>,
                      ul: ({ children }) => <ul className="list-none mb-2 space-y-0.5">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
                      li: ({ children }) => (
                        <li className="text-sm flex gap-1.5">
                          <span className="text-[#ff4500] shrink-0">{String.fromCharCode(9658)}</span>
                          <span>{children}</span>
                        </li>
                      ),
                      code: ({ children, className }) =>
                        className ? (
                          <code className="block bg-[#0a0a0e] text-[#9090a0] rounded-sm px-3 py-2 text-xs font-mono whitespace-pre-wrap mt-1 mb-2 overflow-x-auto border border-[#1e1e28]">{children}</code>
                        ) : (
                          <code className="bg-[#0a0a0e] text-[#c0c0c8] rounded-sm px-1.5 text-xs font-mono border border-[#1e1e28]">{children}</code>
                        ),
                      pre: ({ children }) => <pre className="bg-[#0a0a0e] text-[#9090a0] rounded-sm p-2 text-xs font-mono whitespace-pre-wrap mt-1 mb-2 overflow-x-auto border border-[#1e1e28]">{children}</pre>,
                      blockquote: ({ children }) => <blockquote className="border-l-2 border-[#ff4500]/40 pl-2 italic text-[#888] my-1">{children}</blockquote>,
                      hr: () => <hr className="border-[#252535] my-2" />,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              )}

              <div className={`flex items-center gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-sm ${modeBadge[msg.mode]}`}>
                  {modeLabel[msg.mode].toLowerCase()}
                </span>
                <span className="text-[10px] font-mono text-[#aaa] dark:text-[#444] opacity-0 group-hover:opacity-100 transition-opacity">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {msg.role === 'assistant' && (
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(msg.content);
                      showToast({ text: 'Copied', appearance: 'success' });
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono text-[#aaa] dark:text-[#555] hover:text-[#ff4500] uppercase tracking-wider"
                  >
                    copy
                  </button>
                )}
              </div>
            </div>
          ))}

          {thinking && (
            <div className="self-start flex items-center gap-1.5 px-3 py-2.5 bg-[#f6f6f8] dark:bg-[#1a1a22] border-l-2 border-[#ff4500]/40 rounded-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff4500]/50 animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff4500]/50 animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff4500]/50 animate-bounce [animation-delay:300ms]" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-3 border-t border-[#e0e0e0] dark:border-[#1e1e28] flex gap-2 items-end bg-white dark:bg-[#13131a]">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder[mode]}
            rows={2}
            className="flex-1 resize-none bg-[#f5f5f5] dark:bg-[#0d0d12] border border-[#ddd] dark:border-[#252530] text-sm text-gray-900 dark:text-[#d0d0d8] placeholder-[#bbb] dark:placeholder-[#3a3a4a] p-2 font-mono text-xs focus:outline-none focus:border-[#ff4500] dark:focus:border-[#ff4500] transition-colors rounded-sm"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || thinking}
            className="bg-[#ff4500] hover:bg-[#e03d00] text-white text-[10px] font-mono px-3 py-2 transition-colors disabled:opacity-40 shrink-0 uppercase tracking-widest rounded-sm"
          >
            Send
          </button>
        </div>
      </div>

      {/* Right: Code panel — always dark */}
      <div className="flex flex-col w-1/2 bg-[#0a0a0e]">

        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e1e28] bg-[#0d0d12] shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs text-[#4a4a5a]">config/automoderator</span>
            {hasUnsavedChanges && (
              <span className="text-[10px] font-mono text-amber-400 border border-amber-400/25 bg-amber-400/5 px-1.5 py-0.5 rounded-sm">
                {String.fromCharCode(9679)} unsaved
              </span>
            )}
            {isEditing && (
              <span className="text-[10px] font-mono text-[#ff4500] border border-[#ff4500]/25 bg-[#ff4500]/5 px-1.5 py-0.5 rounded-sm">
                editing
              </span>
            )}
          </div>
          <div className="flex items-center border border-[#1e1e28]">
            <button
              onClick={() => void openHistory()}
              className="text-[10px] font-mono text-[#555] hover:text-[#c0c0c8] hover:bg-[#1a1a22] px-2.5 py-1.5 border-r border-[#1e1e28] transition-colors uppercase tracking-wider"
            >
              history
            </button>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(workingConfig);
                showToast({ text: 'Config copied', appearance: 'success' });
              }}
              disabled={!workingConfig.trim()}
              className="text-[10px] font-mono text-[#555] hover:text-[#c0c0c8] hover:bg-[#1a1a22] px-2.5 py-1.5 border-r border-[#1e1e28] transition-colors disabled:opacity-30 uppercase tracking-wider"
            >
              copy
            </button>
            <button
              onClick={() => setIsEditing((v) => !v)}
              className={`text-[10px] font-mono px-2.5 py-1.5 border-r border-[#1e1e28] transition-colors uppercase tracking-wider ${
                isEditing
                  ? 'text-[#ff4500] bg-[#ff4500]/10 hover:bg-[#ff4500]/20'
                  : 'text-[#555] hover:text-[#c0c0c8] hover:bg-[#1a1a22]'
              }`}
            >
              {isEditing ? 'view' : 'edit'}
            </button>
            <button
              onClick={handleReplaceClick}
              className="text-[10px] font-mono text-red-500/60 hover:text-red-400 hover:bg-[#1a1a22] px-2.5 py-1.5 border-r border-[#1e1e28] transition-colors uppercase tracking-wider"
            >
              replace all
            </button>
            <button
              onClick={handleSaveClick}
              disabled={!hasUnsavedChanges}
              className="text-[10px] font-mono text-[#ff4500] hover:bg-[#ff4500]/10 px-2.5 py-1.5 transition-colors disabled:opacity-30 uppercase tracking-wider"
            >
              save to wiki
            </button>
          </div>
        </div>

        {/* YAML viewer / editor */}
        <div className="flex-1 overflow-hidden relative">
          {isEditing ? (
            <textarea
              value={workingConfig}
              onChange={(e) => setWorkingConfig(e.target.value)}
              className="h-full w-full resize-none bg-[#0a0a0e] text-[#c8c8d8] font-mono text-[13px] leading-[1.65] p-4 focus:outline-none caret-[#ff4500]"
              spellCheck={false}
              autoFocus
              placeholder="# Paste or type your AutoModerator YAML here"
            />
          ) : (
            <>
              <div
                className="absolute inset-0 pointer-events-none z-10 opacity-[0.018]"
                style={{ backgroundImage: 'repeating-linear-gradient(0deg, #fff 0px, #fff 1px, transparent 1px, transparent 4px)' }}
              />
              <div className="h-full overflow-auto">
                {workingConfig.trim() ? (
                  <div className="font-mono text-[13px] text-[#c8c8d8] leading-[1.65]">
                    {workingConfig.split('\n').map((line, i) => (
                      <div key={i} className="flex hover:bg-white/[0.02] group">
                        <span className="select-none text-right text-[#2e2e3a] group-hover:text-[#3e3e4a] pr-3 pl-4 w-12 shrink-0 text-[11px] pt-px border-r border-[#1a1a24] bg-[#0d0d12] transition-colors">
                          {i + 1}
                        </span>
                        <span className="pl-4 whitespace-pre-wrap break-words min-w-0">
                          {line ? highlightLine(line) : ' '}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full font-mono text-center">
                    <div>
                      <div className="text-[#1e1e28] text-4xl mb-4 select-none">{ }</div>
                      <div className="text-xs text-[#2a2a35]">no config loaded</div>
                      <div className="text-[10px] text-[#1e1e28] mt-1">use generate mode to add your first rule</div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-4 py-1.5 border-t border-[#1e1e28] bg-[#0d0d12] text-[10px] font-mono text-[#2e2e3a] text-center shrink-0">
          {isEditing
            ? 'editing directly — click "view" to return to highlighted view, then save to wiki'
            : 'AI-generated YAML — test on a low-traffic post before relying on new rules'}
        </div>
      </div>

      {saveFlow?.step === 'rewrite-confirm' && (
        <RewriteConfirmModal onConfirm={confirmRewrite} onCancel={() => setSaveFlow(null)} />
      )}
      {saveFlow?.step === 'diff-preview' && (
        <DiffPreviewModal
          oldContent={savedConfig}
          newContent={saveFlow.appendMode ? workingConfig.slice(savedConfig.length) : saveFlow.contentToSave}
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
            quota: data.quota,
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
            quota: data.quota,
          });
        }
      } catch (err) {
        console.error('Init failed', err);
        setState({ stage: 'loading' });
      }
    };
    void init();
  }, []);

  if (state.stage === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0a0e]">
        <div className="flex flex-col items-center gap-4 font-mono">
          <div className="w-7 h-7 border-2 border-[#ff4500]/20 border-t-[#ff4500] rounded-full animate-spin" />
          <div className="text-[10px] text-[#3a3a4a] tracking-widest uppercase">
            loading modscript<span className="animate-pulse">.</span><span className="animate-pulse [animation-delay:200ms]">.</span><span className="animate-pulse [animation-delay:400ms]">.</span>
          </div>
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
            initialQuota={state.quota}
          />
          <PrivacyModal
            subredditName={state.subredditName}
            onAck={() => {
              if (!state.currentConfig.trim()) {
                setState({ stage: 'template', postId: state.postId, subredditName: state.subredditName, username: state.username });
              } else {
                setState({ stage: 'app', postId: state.postId, subredditName: state.subredditName, username: state.username, initialConfig: state.currentConfig, quota: state.quota });
              }
            }}
          />
        </>
      )}
      {state.stage === 'template' && (
        <>
          <MainApp subredditName={state.subredditName} username={state.username} initialConfig="" initialQuota={DEFAULT_QUOTA} />
          <TemplatePicker
            onSelect={(_, yaml) =>
              setState({ stage: 'app', postId: state.postId, subredditName: state.subredditName, username: state.username, initialConfig: yaml, quota: DEFAULT_QUOTA })
            }
          />
        </>
      )}
      {state.stage === 'app' && (
        <MainApp
          subredditName={state.subredditName}
          username={state.username}
          initialConfig={state.initialConfig}
          initialQuota={state.quota}
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
