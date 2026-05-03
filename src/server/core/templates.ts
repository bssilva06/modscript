import type { TemplateName } from '../../shared/api';

export type { TemplateName };

export type Template = {
  id: TemplateName;
  label: string;
  description: string;
  yaml: string;
};

const GENERAL: Template = {
  id: 'general',
  label: 'General Community',
  description: 'Baseline spam and karma filters suitable for most subreddits.',
  yaml: `---
# Remove submissions from very new accounts
type: submission
author:
  account_age: < 7 days
  comment_karma: < 10
action: remove
action_reason: "Your account is too new to post here. Please read the rules and try again in a week."
---
# Flag low-karma accounts for mod review
type: submission
author:
  combined_karma: < 5
action: report
action_reason: "Low karma — possible spam account."
---
# Remove posts with spam phrases in the title
type: submission
title (includes, any, case-insensitive):
  - "CLICK HERE"
  - "FREE MONEY"
  - "make money fast"
  - "limited offer"
action: remove
action_reason: "Post removed by AutoModerator — see subreddit rules."
---
# Require post flair
type: submission
is_flair_text: ""
action: remove
action_reason: "Please select a post flair before submitting."
`,
};

const GAMING: Template = {
  id: 'gaming',
  label: 'Gaming',
  description: 'Flair requirements, low-effort title filter, and spam guards for game-focused subs.',
  yaml: `---
# Require post flair
type: submission
is_flair_text: ""
action: remove
action_reason: "Please select a flair (Discussion, Bug, Achievement, Clip, etc.) before posting."
---
# Flag possible low-effort titles
type: submission
title (regex): "(?i)^(i |me |my |help|can |does |do |is |are |any(one)?\\b)"
action: report
action_reason: "Possible low-effort post — mods will review."
---
# Remove very new accounts
type: submission
author:
  account_age: < 3 days
action: remove
action_reason: "New accounts cannot post here. Please wait a few days."
---
# Auto-report account-sharing / boosting phrases
type: submission+comment
body+title (includes, any, case-insensitive):
  - "account boost"
  - "elo boost"
  - "buy account"
  - "sell account"
action: report
action_reason: "Possible account-trading content — please review."
`,
};

const SUPPORT: Template = {
  id: 'support',
  label: 'Support / Mental Health',
  description: 'Crisis-keyword alerting and anti-minimization rules for sensitive communities.',
  yaml: `---
# Flag crisis language for immediate mod review
type: comment+submission
body+title (includes, any, case-insensitive):
  - "kill myself"
  - "end it all"
  - "want to die"
  - "don't want to be here"
  - "suicide"
  - "self-harm"
action: report
action_reason: "Possible crisis post — please check on this user immediately."
---
# Remove minimizing / invalidating language
type: comment
body (includes, any, case-insensitive):
  - "just get over it"
  - "other people have it worse"
  - "man up"
  - "it's not that bad"
  - "you're overreacting"
action: remove
action_reason: "This community does not allow dismissive or minimizing language. Please review the community rules."
---
# Block new accounts from posting (higher risk in sensitive spaces)
type: submission
author:
  account_age: < 1 day
action: remove
action_reason: "New accounts cannot post here. Please wait 24 hours."
---
# Require post flair
type: submission
is_flair_text: ""
action: remove
action_reason: "Please select a post flair (Seeking Support, Venting, Resource, etc.) before posting."
`,
};

const NEWS: Template = {
  id: 'news',
  label: 'News',
  description: 'Source attribution enforcement, link-karma gates, and breaking-news auto-flair.',
  yaml: `---
# Gate link posts behind link karma
type: link
author:
  account_age: < 30 days
  link_karma: < 10
action: remove
action_reason: "Your account needs more link karma to post links here."
---
# Encourage source attribution in title
type: submission
title (regex): "^(?!.*\\(|.*\\[)"
action: report
action_reason: "Please include the news outlet in the title, e.g. (Reuters) or [BBC News]."
---
# Auto-flair breaking news posts
type: submission
title (includes, any, case-insensitive):
  - "BREAKING"
  - "JUST IN"
  - "DEVELOPING"
action: flair
flair_text: "Breaking News"
---
# Remove duplicate-looking reposts
type: submission
author:
  account_age: < 7 days
  link_karma: < 50
set_locked: true
action_reason: "Post locked pending mod review — possible repost from low-history account."
`,
};

export const TEMPLATES: Template[] = [GENERAL, GAMING, SUPPORT, NEWS];

export const getTemplate = (id: TemplateName): Template | undefined =>
  TEMPLATES.find((t) => t.id === id);
