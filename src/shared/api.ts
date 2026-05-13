export type AppMode = 'generate' | 'explain' | 'conflict';

export type QuotaModeStatus = {
  used: number;
  cap: number;
};

export type TemplateName = 'general' | 'gaming' | 'support' | 'news' | 'blank';

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
