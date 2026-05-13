export type AppMode = 'generate' | 'explain' | 'conflict';

export type QuotaModeStatus = {
  used: number;
  cap: number;
};

export type TemplateName =
  | 'general'
  | 'gaming'
  | 'support'
  | 'news'
  | 'finance'
  | 'nsfw'
  | 'meme'
  | 'ama'
  | 'sports'
  | 'local'
  | 'blank';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  mode: AppMode;
  timestamp: number;
};

export type InitResponse = {
  type: 'init';
  postId: string;
  subredditName: string;
  username: string;
  privacyAcked: boolean;
  currentConfig: string;
  quota: Record<AppMode, QuotaModeStatus>;
  readiness: {
    wikiReadable: boolean;
    wikiWritable: boolean;
    modPermissions: string[];
    message?: string;
  };
  byoKeyConfigured: boolean;
  conflictGate?: {
    enabled: boolean;
    hasAccess: boolean;
    sku?: string;
  };
  lastBackupAvailable?: boolean;
};

export type PrivacyAckResponse = {
  type: 'privacy-ack';
  success: boolean;
};

export type GenerateRequest = {
  message: string;
  currentConfig: string;
  history: ChatMessage[];
};

export type GenerateResponse = {
  type: 'generate';
  yaml: string;
  assistantMessage: string;
};

export type ExplainRequest = {
  config: string;
};

export type ExplainResponse = {
  type: 'explain';
  explanation: string;
};

export type ConflictRequest = {
  config: string;
};

export type ConflictResponse = {
  type: 'conflict';
  report: string;
};

export type SaveRequest = {
  content: string;
  appendMode: boolean;
  summary: string;
};

export type SaveResponse = {
  type: 'save';
  success: boolean;
  verified: boolean;
  savedContent: string;
  message?: string;
  timestamp: number;
};

export type UndoLastSaveResponse = {
  type: 'undo-last-save';
  success: boolean;
  verified: boolean;
  restoredContent: string;
  message?: string;
};

export type ValidateYamlRequest = {
  content: string;
};

export type ValidateYamlResponse = {
  type: 'validate-yaml';
  valid: boolean;
  message: string;
  line?: number;
  column?: number;
};

export type DemoConfigResponse = {
  type: 'demo-config';
  yaml: string;
};

export type RuleTestContentType = 'submission' | 'comment' | 'any';

export type RuleTestRequest = {
  config: string;
  sample: {
    type: RuleTestContentType;
    title: string;
    body: string;
    url: string;
    domain: string;
    authorAgeDays: number;
    combinedKarma: number;
    commentKarma: number;
    linkKarma: number;
    flairText: string;
  };
};

export type RuleTestResult = {
  index: number;
  name: string;
  action: string;
  matched: boolean;
  matchedConditions: string[];
  unsupportedConditions: string[];
};

export type RuleTestResponse = {
  type: 'test-rules';
  results: RuleTestResult[];
  summary: {
    matched: number;
    notMatched: number;
    unsupported: number;
  };
  note: string;
};

export type ByoKeyStatusResponse = {
  type: 'byo-key-status';
  configured: boolean;
};

export type SetByoKeyRequest = {
  apiKey: string;
};

export type SetByoKeyResponse = {
  type: 'set-byo-key';
  configured: boolean;
};

export type ErrorResponse = {
  status: 'error';
  message: string;
};

export type WikiRevision = {
  id: string;
  timestamp: number;
  author: string;
  reason: string;
};

export type RevisionsResponse = {
  type: 'revisions';
  revisions: WikiRevision[];
};

export type RevertRequest = {
  revisionId: string;
};

export type RevertResponse = {
  type: 'revert';
  success: boolean;
  content: string;
};

export type RevisionContentResponse = {
  type: 'revision-content';
  content: string;
};
