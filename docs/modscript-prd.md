# ModScript — Product Requirements Document

**Project:** ModScript  
**Platform:** Reddit Developer Platform (Devvit)  
**Hackathon:** Reddit Mod Tools & Migrated Apps Hackathon (Apr 29 – May 27, 2026)  
**Author:** Ben Silva  
**Version:** 1.5  
**Status:** Draft — Pivoted from Anthropic Claude to Google Gemini per Reddit's Devvit AI provider policy (only Google Gemini and OpenAI/ChatGPT are approved); billing model finalized as Model A (developer-provided global key with rate limits)  

---

## 1. Overview

### 1.1 Problem Statement

AutoModerator is Reddit's primary moderation tool, used by virtually every large subreddit. Configuration is written in YAML — a format that is error-prone, poorly documented, and intimidating to the majority of moderators. As a result:

- New moderators copy-paste rules they don't understand
- Existing configs accumulate conflicts and dead rules over time
- Mods who inherit subreddits have no way to quickly audit what their config actually does
- Every existing AI tool to help with AutoMod is an **external website**, requiring mods to leave Reddit entirely

There is no AI-powered AutoMod tool native to the Devvit ecosystem.

### 1.2 Solution

**ModScript** is a Devvit mod tool that lives inside Reddit's native mod panel. It gives moderators a conversational AI interface — powered by Gemini — to generate, explain, and audit their AutoModerator configuration without writing a single line of YAML or ever leaving Reddit.

### 1.3 Hackathon Category

**New Mod Tool** — this is a net-new capability in the Devvit App Directory. Based on a search of the App Directory and Devvit community, no AI-native AutoMod tool with Generate + Explain + Conflict Check modes exists natively on Reddit's platform. This claim should be re-verified at `developers.reddit.com/apps` before submission. If a basic generator exists, the differentiator repositions to: *"first AI-native tool with bidirectional YAML/English translation and pattern-based conflict analysis."*

---

## 2. Goals

### 2.1 Primary Goals

- Allow any moderator to generate valid AutoMod YAML rules using plain English
- Allow moderators to paste existing YAML and receive a plain English explanation of what it does
- Detect conflicts and redundancies in a mod's existing AutoMod config
- Write finalized rules directly back to the subreddit's AutoMod wiki — no copy/pasting
- Be installable by any subreddit in one click from the App Directory

### 2.2 Hackathon Judging Goals

| Criterion | How We Address It |
|---|---|
| Community Impact | Solves the #1 barrier to AutoMod adoption across all subreddits |
| Time Savings | Eliminates hours of YAML trial-and-error per rule |
| Polish | Native Devvit UI, direct wiki integration, zero external tools needed |
| Reliable UX | Easy to install, zero config required |
| Ecosystem Impact | First AI-native AutoMod tool with Generate + Explain + Conflict Check in the Devvit App Directory (verify before submission) |

---

## 3. Users

### 3.1 Primary User

**The Reddit Moderator**

- Volunteers managing communities ranging from 1K to 10M+ members
- Skill level varies widely — many are not technical
- Core pain: too much repetitive moderation work, not enough tooling

### 3.2 User Personas

**"The Inheritor"** — Became a mod of an existing subreddit. Has a 500-line AutoMod config written by someone else years ago. Has no idea what half the rules do and is afraid to touch them.

**"The Founder"** — Started a new subreddit that is growing. Knows they need AutoMod but has never written YAML and doesn't know where to start.

**"The Power Mod"** — Moderates 15+ subreddits. Needs to quickly replicate or adapt rule sets across communities. Wants efficiency, not a learning curve.

---

## 4. Features

### 4.1 Core Features (MVP — Must Ship)

#### F1 — Natural Language → YAML (Generate Mode)
- Mod types a plain English description of a rule they want
- Gemini generates valid, formatted AutoMod YAML
- Output is displayed in a syntax-highlighted code panel
- Mod can refine via follow-up messages in the same conversation
- **Append-only by default:** generated rules are appended to the existing config, never rewriting it. This is the safe default — a 400-line hand-tuned config is never silently clobbered.
- **Explicit rewrite mode:** a clearly labeled "Rewrite full config" button is available behind a confirmation dialog for mods who want Gemini to restructure their entire config. This must require a second click to confirm and triggers an automatic Redis backup before proceeding.

#### F2 — YAML → Plain English (Explain Mode)
- Mod pastes an existing YAML block or loads their full config
- Gemini explains each rule in plain English: what triggers it, what action it takes, and any edge cases
- Output is formatted rule-by-rule for readability
- Powered by `gemini-2.5-flash` (fast, low cost, more than sufficient for summarization)

#### F3 — Pattern-Based Config Analyzer (Conflict Checker)
- Mod submits their full AutoMod config
- Gemini identifies: duplicate keyword lists, rules with identical triggers, suspicious action ordering, and structurally redundant rules
- Returns a list of flagged patterns with suggested fixes
- **Scope note:** This is heuristic pattern analysis, not execution simulation. The tool does not claim to predict exactly which rules would fire at runtime — it flags structural issues a human mod should review. This framing must be reflected in UI copy.
- Powered by `gemini-2.5-pro` (reasoning-heavy task; same model as Generate, but the F11 quota gate is much tighter — 5/day/sub vs 50/day/sub — to bound the per-call cost of long-input runs)

#### F4 — Direct Wiki Read/Write with Guardrails
- On open, the app auto-fetches the subreddit's existing `config/automoderator` wiki page via `reddit.getWikiPage(subredditName, 'config/automoderator')`
- **Save behavior mirrors F1:** default action is always append (new rules added to the bottom of the existing config). Full rewrites require the explicit "Rewrite full config" flow with confirmation.
- **Before any save:** app shows a diff preview modal displaying exactly what will change — additions highlighted green, removals highlighted red
- **Every save calls `wikiPage.update(content, reason)`** with a human-readable `reason` string (e.g., `"ModScript — appended rule: remove posts from accounts under 3 days old"`). The `reason` appears in Reddit's native wiki revision history.
- **Run as the moderator, not the app:** wiki updates use `runAs: USER` so the revision is attributed to the actual mod who clicked Save. *Pending verification in Week 1 that `runAs` is supported on `WikiPage.update`; if not, fall back to writing as the app and note it in a toast on save.*
- **Redis backup on every save** — the previous content is snapshotted to a Redis key (`automod:backup:<subreddit>:<timestamp>`) immediately before the wiki write, capped at the last 5 versions. This is a complementary fast-restore safety net; **Reddit's native wiki revision history is the canonical record** (queryable via `wikiPage.getRevisions()` and reversible via `wikiPage.revertTo(revisionId)`).
- Mod can save finalized rules directly back to the wiki from inside the app
- No copy/pasting to/from Reddit required

#### F5 — Privacy Disclosure (First Launch)
- On first open, a one-time modal displays: *"ModScript sends your AutoMod configuration to Google's Gemini API for processing. This may include usernames or community-specific content in your config. Data is handled per [Google's Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)."*
- Mod must acknowledge before proceeding
- Acknowledgement stored in Redis per moderator username and subreddit, so every moderator accepts for themselves

#### F6 — Starter Template Picker (4 templates for MVP)
- On first open (after privacy disclosure), mod can select their subreddit type or start blank
- MVP ships with 4 templates: **General**, **Gaming**, **Support/Mental Health**, and **News**
- Templates are YAML strings — low content effort (~2 hours total), meaningfully better UX than a 2-option picker
- UI framing: "Start from a template, or start blank?" with the 4 types + a "Start blank" option
- Additional templates (Finance, NSFW, Meme, AMA, Sports) move to stretch

#### F11 — Cost Controls Infrastructure (load-bearing, not user-facing)

Because the developer pays for all Gemini usage under the Model A billing model (see §7.3), the following infrastructure is **MVP-required** to bound cost. These are not user-facing features but they ship as part of the hackathon submission.

- **Per-subreddit-per-day quotas in Redis**, separate per mode. Quotas increment only after successful Gemini responses. Suggested defaults (tunable via global setting):
  - Generate (Pro): **50 calls/day/subreddit**
  - Explain (Flash): **50 calls/day/subreddit**
  - Conflict Check (Pro): **5 calls/day/subreddit**
  - Implementation: read `quota:<subreddit>:<mode>:<YYYYMMDD>` before the call, reject with a friendly toast when the cap is hit, and `INCR` the key with a 48-hour `EXPIRE` only after a successful AI response.
- **Global kill switch.** A single global setting (`paused: boolean`) the developer can flip via CLI. Server reads it on every Gemini call and short-circuits with a "temporarily unavailable" message.
- **Max input token cap.** Configs above ~50K tokens are rejected client-side and server-side with a clear error before any API call is made. Defends against pathological inputs.
- **Server-side usage logging.** Token counts (input/output, from Gemini's `usageMetadata`) are written to Redis keyed by subreddit and day with 48-hour retention. No UI required for hackathon — this short-lived data exists for the developer to audit cost and tune quotas during judging.
- All four behaviors are bypassed only via developer-side global settings; no per-subreddit override exists in the hackathon build.

### 4.2 Stretch Features (Ship if Time Allows)

#### F7 — Extended Template Library
- Expand template picker from the 4 MVP types to 7+ subreddit types
- Additional types: Meme/Humor, Finance, NSFW, AMA, Sports

#### F8 — Revert / Version History UI
- Built on Reddit's native wiki revisions: `wikiPage.getRevisions()` for the listing, `wikiPage.revertTo(revisionId)` for one-click restore
- UI shows the last N revisions with the moderator name, date, and `reason` string from each save
- Diff between any two revisions rendered in the same component as the F4 save-time diff preview
- Redis backups (from F4) remain as a faster-restore cache and as a safety net for revisions that pre-date the app's installation

#### F9 — Rule Tester (Sandbox Mode)
- Mod pastes a sample post title/body and runs it against their current config
- App simulates which rules would fire and what actions would be taken

#### F10 — Shareable Rule Snippets
- Mod can export a specific rule as a copyable block
- Enables mods to share useful rules across communities (e.g., on r/modhelp)

---

## 5. Technical Specification

### 5.1 Stack

This repo is scaffolded with the **Devvit Web** template (not the older Devvit Blocks API). The stack below reflects what is actually installed in `package.json`.

| Layer | Technology |
|---|---|
| Platform | Devvit Web (`@devvit/web` 0.12.x) |
| Language | TypeScript 5.9 |
| Runtime | Node 22 (serverless) |
| Frontend | React 19, Tailwind CSS 4, Vite 7 — runs inside an iframe on reddit.com |
| Backend | Hono 4 router served via `@hono/node-server` and `@devvit/web/server` |
| Client ↔ Server | Standard HTTP `fetch` from the iframe to Hono routes (no `postMessage` bridge required) |
| AI — Explain Mode | `gemini-2.5-flash` (fast, low cost, sufficient for summarization) |
| AI — Generate Mode | `gemini-2.5-pro` (balance of quality and cost for YAML generation) |
| AI — Conflict Analyzer | `gemini-2.5-pro` (reasoning-heavy task; same model as Generate, gated by tighter F11 quota) |
| Storage | Devvit Redis via `redis` from `@devvit/web/server` |
| Reddit API | `reddit` and `context` from `@devvit/web/server` |
| External API | Google Gemini API via server-side `fetch()` |
| Config | `devvit.json` (menu items, forms, triggers, post entrypoints) |
| Dev Tooling | Devvit CLI (`devvit playtest`), Vite, ESLint 9, Vitest |

### 5.2 App Entry Point

Registered as a **mod-only menu action** in `devvit.json` under `menu.items` with `location: "subreddit"` and `forUserType: "moderator"`. The menu item's `endpoint` points to a Hono route in `src/server/routes/menu.ts` that creates a post backed by the expanded `game.html` view. The menu item appears in the subreddit mod tools panel as "ModScript" and is only visible to users with mod permissions.

### 5.3 Architecture

```
┌─────────────────────────────────────┐
│  Mod clicks "ModScript"              │
│  in subreddit mod tools menu         │
└────────────────┬────────────────────┘
                 │ devvit.json → /internal/menu/...
┌────────────────▼────────────────────┐
│   Hono server (src/server)           │
│   creates post → opens game.html     │
└────────────────┬────────────────────┘
                 │
┌────────────────▼────────────────────┐
│      React iframe (game.html)        │
│  ┌──────────────┐  ┌──────────────┐ │
│  │  Chat Panel  │  │  Code Panel  │ │
│  │ (conversation│  │ (YAML output │ │
│  │  interface)  │  │  + editor)   │ │
│  └──────────────┘  └──────────────┘ │
│  ┌────────────────────────────────┐ │
│  │  Mode Toggle: Generate /       │ │
│  │  Explain / Conflict Check      │ │
│  └────────────────────────────────┘ │
└────────────────┬────────────────────┘
                 │ HTTP fetch → /api/...
┌────────────────▼────────────────────┐
│    Hono routes (src/server/routes)   │
│  ┌──────────┐ ┌───────┐ ┌────────┐ │
│  │ gemini.ts│ │wiki.ts│ │redis.ts│ │
│  │ (core)   │ │ (core)│ │ (core) │ │
│  └────┬─────┘ └───┬───┘ └───┬────┘ │
└───────│────────────│──────────│──────┘
        │            │          │
   Google Gemini  reddit         redis
   (fetch)    (getWikiPage/  (history,
              updateWikiPage)  templates,
                              backups)
```

### 5.4 File Structure

This matches the Devvit Web template scaffold already in the repo. Files marked **(new)** are to be added during implementation; everything else exists.

```
modscript06/
├── devvit.json                  # Menu items, forms, triggers, post entrypoints
├── package.json
├── tsconfig.json
├── vite.config.ts
├── eslint.config.js
├── public/
└── src/
    ├── shared/
    │   └── api.ts               # Types shared between client and server
    ├── server/                  # Node 22 serverless (Hono)
    │   ├── index.ts             # Hono app, mounts /api and /internal
    │   ├── routes/
    │   │   ├── api.ts           # Public endpoints called by the iframe
    │   │   ├── menu.ts          # Menu item handlers
    │   │   ├── forms.ts         # Form submit handlers
    │   │   └── triggers.ts      # onAppInstall, etc.
    │   └── core/
    │       ├── post.ts          # Post creation helper
    │       ├── gemini.ts        # (new) Google Gemini API calls + prompts
    │       ├── wiki.ts          # (new) AutoMod wiki read/write + diffing
    │       ├── history.ts       # (new) Redis-backed config backups
    │       └── templates.ts     # (new) Starter configs by subreddit type
    └── client/                  # React iframe
        ├── splash.html          # Inline view in feed — keep small
        ├── splash.tsx
        ├── game.html            # Expanded view — main app
        ├── game.tsx             # (replace) Root component, mode state
        ├── index.css
        ├── module.d.ts
        ├── global.ts
        ├── hooks/               # (new) e.g. useChat, useDiff
        └── components/          # (new) ChatPanel, CodePanel, TemplateModal, DiffPreview, PrivacyDisclosure
```

> Note: the PRD originally proposed `src/main.ts` and `src/webview/` with `devvit.yaml`. That layout is for the older Devvit Blocks API and is **not** used here. Do not introduce `@devvit/public-api` or `Devvit.addMenuItem()` — see §5.6.

### 5.5 Gemini System Prompt Strategy

The system prompt will include:
- The complete AutoMod YAML specification and all supported fields
- The subreddit's existing config (fetched on load)
- The subreddit type (from template picker or inferred)
- Mode-specific instructions (Generate / Explain / Conflict Analyzer)
- Output formatting rules (raw YAML only for Generate mode, structured text for Explain/Conflict)

Each mode uses a Gemini model chosen to balance cost and quality:

| Mode | Model | Rationale |
|---|---|---|
| Explain | `gemini-2.5-flash` | Summarization is well within Flash's capability; keeps cost low for the most-used mode |
| Generate | `gemini-2.5-pro` | YAML generation benefits from stronger instruction-following |
| Conflict Analyzer | `gemini-2.5-pro` | Structural reasoning across a full config warrants the strongest available Gemini tier; same model as Generate, but the F11 quota differential (5 vs 50 calls/sub/day) is what bounds the cost on this long-input workload |

Conversation history is maintained in Redis and injected into each API call to support multi-turn refinement.

### 5.6 Key Devvit APIs Used

All server-side imports come from `@devvit/web/server`; client-side helpers come from `@devvit/web/client`. The older `@devvit/public-api` / Devvit Blocks API is **not** used.

| API | Source | Purpose |
|---|---|---|
| `devvit.json` `menu.items` | config | Register mod-only entry point (replaces `Devvit.addMenuItem()`) |
| `devvit.json` `permissions` | config | Declare required capabilities — `redis: true`, `reddit: true`, `http: ["generativelanguage.googleapis.com"]` |
| `devvit.json` `settings.global` | config | Declare the developer's Gemini API key as a global secret (`isSecret: true`) plus quota tunables and the `paused` kill switch |
| `reddit.getWikiPage(subreddit, page)` | `@devvit/web/server` | Fetch existing `config/automoderator`, returns a `WikiPage` instance |
| `wikiPage.update(content, reason)` | `@devvit/web/server` | Write finalized config back; `reason` populates Reddit's native revision history |
| `wikiPage.getRevisions()` / `wikiPage.revertTo(id)` | `@devvit/web/server` | Powers F8 stretch version history without needing a custom store |
| `runAs: USER` option on wiki writes | `@devvit/web/server` | Attribute the wiki revision to the moderator who clicked Save (verify in Week 1 — see §10) |
| `settings.get('geminiApiKey')` | `@devvit/web/server` | Read the developer's global Gemini secret on the server only — never returned to the client |
| `redis` | `@devvit/web/server` | Store conversation history, backups, templates, privacy ack, daily quotas, usage logs |
| `redisCompressed` | `@devvit/web/server` | Optional escape hatch if a stored config approaches the 5 MB request limit. **Note:** one-way migration — once written compressed, it cannot be read by the standard client |
| `context` | `@devvit/web/server` | Read `subredditName`, `postId`, current user info |
| `fetch()` | global | Server-side calls to `generativelanguage.googleapis.com` (must be allow-listed in `permissions.http`) |
| Hono routes (`/api/*`) | `hono` | Endpoints the iframe calls (replaces the `postMessage` event handler model). All client-callable routes must live under `/api/`. |
| `navigateTo`, `showToast`, `showForm` | `@devvit/web/client` | Client-side UI primitives |

**Required `permissions` block** (must be added to `devvit.json` — the scaffold currently omits it):

```json
"permissions": {
  "reddit": true,
  "redis": true,
  "http": ["generativelanguage.googleapis.com"]
}
```

Reddit's Devvit allow-list has **no global pre-approval** — every app must request its own external domains, even for `devvit playtest`. The first `devvit upload` (or `devvit playtest`) submits any new domains to the manual admin review queue (historically reviewed Tuesdays, 2+ weeks SLA). Approval status surfaces on `developers.reddit.com/my/apps` under Developer Settings. See §7.3 and §10 for timeline implications.

---

## 6. User Flow

### 6.1 First-Time Flow

```
1. Mod installs app from App Directory  (no API key entry — the developer's
                                          shared Gemini key is built in)
2. Mod opens subreddit mod tools → clicks "ModScript"
3. Privacy disclosure modal appears → mod acknowledges
4. App fetches existing AutoMod config (may be empty)
5. Template picker appears: "Start from a template, or start blank?"
   Options: General / Gaming / Support / News / Start blank
6. Mod selects → starter config (or empty) loads in Code Panel
7. Mod begins conversation in Chat Panel to customize (append-only by default;
   subject to per-mode daily quotas — see F11)
8. Satisfied → clicks "Save to AutoMod" → diff preview shown → mod confirms →
   wiki updated (with reason string), backup saved to Redis
```

### 6.2 Returning Mod Flow

```
1. Mod opens "ModScript" from mod tools
2. Current live config loads automatically
3. Mod picks mode: Generate / Explain / Conflict Check
4. Works iteratively in Chat Panel
5. Saves changes or discards
```

---

## 7. Scope & Constraints

### 7.1 In Scope

- All three core AI modes (Generate, Explain, Conflict Analyzer)
- Direct wiki read/write with diff preview, auto-backup to Redis, and meaningful `reason` strings on every revision
- Privacy disclosure on first launch
- Starter template picker (4 templates: General, Gaming, Support, News + Start blank option)
- Conversation history per subreddit (Redis)
- Mod-only access enforcement
- **Cost-control infrastructure (F11):** per-subreddit daily quotas, global kill switch, max-input-token cap, server-side usage logging

### 7.2 Out of Scope (for hackathon submission)

- Multi-language support
- Mobile optimization (Devvit mod tools are desktop-only)
- Analytics dashboard
- Cross-subreddit rule syncing
- Rule Tester / Sandbox mode (stretch only)
- Extended template library beyond 4 types (stretch only)
- Version history UI (stretch — backup logic is MVP, browser is not)

### 7.3 Constraints & Billing Model

#### AI provider — Google Gemini

Reddit's Devvit policy currently approves only **Google Gemini** and **OpenAI/ChatGPT** as AI providers for hosted apps. ModScript uses Google Gemini via its REST endpoint at `generativelanguage.googleapis.com`. (An earlier draft of this PRD targeted Anthropic Claude; that pivot happened pre-deploy after Reddit support confirmed Claude is not on the approved list.)

#### Billing Model — Model A (developer-provided global key)

- **API billing:** The developer (Ben Silva) provides a single Google Gemini API key, stored as a Devvit **global secret** (`isSecret: true`). Set once via `npx devvit settings set geminiApiKey`. It is encrypted by Devvit, never visible in any UI, never returned to the client, never logged. Every install of the app uses this same key — moderators do not enter or manage their own key.
- **Why Model A:** matches the PRD's primary judging goal (*"Judges can install the app, generate a rule, and save it to a test subreddit without any instructions"*). Zero install friction, zero out-of-band setup, zero client-side credential exposure.
- **Cost is bounded by F11**, not by the billing model. Per-mode-per-subreddit-per-day quotas, a global pause switch, and a max-input-token cap together cap the developer's worst-case monthly bill. Default quotas (5 Conflict Check / 50 Generate / 50 Explain per sub per day) are tunable via global settings without redeploying. During the hackathon build, quota counters advance only on successful Gemini responses so judges are not penalized for provider or network failures.
- **Devvit secrets caveat (informs the design above):** Devvit's "secret" setting type is **global only and CLI-managed only** — moderators cannot store secret values per subreddit. This is why Model A is the only model in which the API key is stored under Devvit's encrypted secrets system. A BYO-key path (Phase 2 in §11) would necessarily use plain subreddit settings, which the docs do not document as encrypted at rest.
- **Post-hackathon path:** see §11 — Model A is not assumed to be sustainable at scale; it's the right call for the hackathon submission window. Phase 2 adds an opt-in BYO-key escape hatch and Phase 3 considers a Devvit IAP path.

#### External fetch and domain approval

- Gemini API calls require `generativelanguage.googleapis.com` to be listed under `permissions.http` in `devvit.json`.
- Reddit's Devvit allow-list has **no global pre-approval** — every app must individually request the exact hostnames it needs (no wildcards). The first `devvit upload` *or* `devvit playtest` submits any new domains to the manual admin review queue. Historically reviewed Tuesdays with a 2+ week SLA. Approval/rejection status surfaces on `developers.reddit.com/my/apps` under Developer Settings. The submission requires (a) a justification section in the README naming each domain and why it's needed, and (b) Privacy Policy + Terms of Service URLs configured in Developer Settings before playtest. This must be initiated on Week 1 day one to parallelize the review with feature work.
- All external calls run **server-side only** — the client iframe is network-locked to the app's own domain and cannot reach `generativelanguage.googleapis.com` directly.
- **HTTPS only**, GET/POST/PUT/DELETE/OPTIONS/PATCH supported. No wildcards in the allow-list.

#### Hard runtime limits (Devvit serverless)

- **Max request time: 30 seconds.** Every Hono handler must complete within 30 seconds — including the Gemini round-trip. Conflict Check on long configs is the most likely to exceed this; mitigated by the F11 max-input-token cap and (if needed) by chunking the analysis. Streaming UIs are not supported because the handler still has to return within 30 seconds.
- **Max request payload: 4 MB.** Max response: 10 MB.
- **Server bundle is CommonJS only**, not ES modules (already handled by the scaffold's `index.cjs` build output).
- **Redis: 500 MB per installation, 5 MB per request, 40,000 commands/sec.** Pipelining and Lua are not supported. `redisCompressed` is available if needed.
- **`localStorage` clears on every app update** — all persistent state must live in Redis.

#### Compliance and documentation

- **Privacy Policy + Terms of Service URLs** are required in app details for any app that uses external `fetch`. Mandatory submission item; must be set in Developer Settings before playtest, not just at submission time.
- **README must include a "Fetch Domains" section** listing every external domain and the reason it is required. Mandatory submission item.
- **Privacy disclosure (F5)** stays as written in spirit: AutoMod configs may contain banned usernames, flagged phrases, or community-specific content. The disclosure informs mods their config is sent to Google's Gemini API per Google's Gemini API Additional Terms. Do not assert specific data retention behavior — that's governed by Google, not this app.

#### Reddit and Devvit constraints

- AutoMod wiki write requires the installing mod to have "Manage Wiki Pages" permission. Handle the failure case with a clear error message.
- The React iframe communicates with the server via standard HTTP `fetch` to Hono routes mounted under `/api`. There is no `postMessage` event-handler bridge in the Devvit Web model — every interaction is a normal request/response.
- All client-callable server endpoints must be prefixed `/api/`. Internal endpoints invoked by the platform (menu, forms, triggers) live under `/internal/` per the scaffold.
- Every new menu item, form, or trigger endpoint must be registered in `devvit.json`. A handler in `src/server/routes` without a matching `devvit.json` entry will not fire.
- Mod menu actions that open a Devvit form have a **10-minute completion window** — does not affect the current design (we open the expanded view, not a form chain), but constrains any future flow that relies on `showForm` from a server menu response.
- Generated YAML is not validated against the live AutoMod parser (no public API exists for this). Gemini is prompted to self-validate, and UI copy advises mods to test on a low-traffic post before relying on new rules in production.

---

## 8. Timeline

| Week | Dates | Milestone |
|---|---|---|
| Week 1 | Apr 29 – May 5 | Devvit Web project scaffolded (done — React + Hono template in place); `permissions` block added to `devvit.json` and **`generativelanguage.googleapis.com` submitted for admin review on day 1** (parallelize review with feature work; Privacy Policy + ToS URLs in Developer Settings, README "Fetch Domains" section published before first playtest); mod-tools menu item registered and routed to the expanded view; `/api/init` end-to-end with iframe verifying `context.subredditName`; wiki read/write functional with `runAs: USER` verification; basic Gemini call (Generate mode) returning YAML in UI; global secret `geminiApiKey` set via CLI |
| Week 2 | May 6 – May 12 | Full UI — chat panel, code panel, all three modes functional; privacy disclosure modal; diff preview modal with native wiki revision history surfaced; 4 starter templates wired in. **No API key setup flow** — Model A means there isn't one. |
| Week 3 | May 13 – May 19 | F11 cost controls landed (per-mode daily quotas in Redis, global `paused` kill switch, max-input-token cap, server-side usage logging); Conflict Analyzer prompt tuned + UI copy scoped correctly; append vs. rewrite flow complete with confirmation dialog; error handling throughout including 30-second timeout fallbacks; quota-exceeded toast copy reviewed |
| Week 4 | May 20 – May 27 | Testing on real subreddits with quotas live; polish; **README "Fetch Domains" section** verified accurate; **Privacy Policy + Terms of Service URLs** confirmed live and reachable; Devpost submission; demo video recorded per shot list below; final verification that `generativelanguage.googleapis.com` review has been approved before publish |

### 8.1 Demo Video Shot List (Week 4)

Judges watch the video before they install. Target length: under 3 minutes.

1. Open ModScript from the mod tools panel (show it's native, no new tab)
2. Privacy disclosure appears → acknowledge → app loads existing config
3. **Generate mode:** type "remove posts from accounts under 3 days old" → show YAML output → show diff preview → save → show updated wiki page
4. **Explain mode:** paste an existing multi-rule config block → show plain English breakdown rule-by-rule
5. **Conflict Analyzer:** run on a config with a known duplicate keyword list → show flagged patterns and suggested fix
6. Close with the wiki page open showing the final saved config

---

## 9. Success Metrics

### Hackathon Judging
- Judges can install the app, generate a rule, and save it to a test subreddit without any instructions
- All three AI modes work reliably end-to-end
- No crashes or broken states during judging demo

### Post-Hackathon (if published)
- **Save rate:** % of sessions where mod clicks "Save to Wiki" (proxy for rule quality — if Gemini's output is good, mods will save it)
- **Time-to-first-save:** median time from first message to first successful wiki write
- App installed in subreddits within 30 days, **bounded by the cost ceiling** of the developer's shared Gemini key (see below)
- Qualifies for Reddit Developer Funds engagement milestones

**Note on adoption vs. cost-ceiling tension (Model A):** Under Model A, every install increases the developer's Google Gemini bill, which is bounded only by F11 quotas. At the default quotas (5 Conflict Check / 50 Generate / 50 Explain per sub per day) and current Gemini pricing, per-subreddit worst-case daily cost is dominated by Conflict Check (long input + Pro model + reasoning workload). The hackathon target installation count should be set against an explicit monthly budget the developer is willing to absorb. If adoption outpaces budget, the next steps are (in order):

1. Tighten F11 quotas (zero-code change — global setting flip).
2. Activate the global `paused` kill switch for non-essential modes.
3. Begin Phase 2 of the post-hackathon roadmap (§11) — add the BYO-key escape hatch to offload heavy users.

---

## 10. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Gemini API latency exceeds Devvit's 30-second handler timeout (especially Pro on long Conflict Check inputs) | Medium | F11 max-input-token cap rejects oversized configs before any API call; tune Conflict Check prompt for brevity; if a single call still risks timeout, chunk the analysis into multiple smaller calls. **Streaming UIs are not viable** — handler must complete in 30s regardless. |
| `generativelanguage.googleapis.com` admin review takes longer than expected and blocks publish | Medium | Submit the domain in `permissions.http` on Week 1 day one with a stub upload (README justification + PP/ToS URLs already in place); check status weekly on `developers.reddit.com/my/apps`; have a fallback message ready if the review window threatens the submission deadline |
| Cost runaway on developer's shared Gemini key (F11 quotas misbehave or are bypassed) | Medium | Quotas are checked before each AI request and incremented only after successful responses; usage is logged server-side per subreddit per day with 48-hour retention; global `paused` kill switch can stop all calls instantly; review token-usage logs daily during the hackathon window |
| Gemini API latency makes UI feel slow (within timeout) | Medium | Show typing indicator on every response; pre-render the YAML code panel skeleton |
| AutoMod wiki write permissions vary by mod | Low | Graceful error message explaining required "Manage Wiki Pages" permission |
| `runAs: USER` is not supported on `WikiPage.update` | Low | Verify in Week 1 with a single test write; if unsupported, fall back to writing as the app and surface the actor in a toast on save |
| Generated YAML has syntax errors | Low | Gemini prompted to self-validate; UI advises testing on low-traffic post before relying on rule in production |
| Iframe ↔ Hono server wiring (auth context, errors) breaks late | Medium | Wire up `/api/init` end-to-end in Week 1 before layering on AI features; verify `context.subredditName` and current user resolve correctly inside Hono handlers |
| Conflict Analyzer overstates its findings | Medium | UI copy explicitly scopes to "structural patterns" not runtime simulation; output framed as "review suggestions" |
| A similar tool exists in the App Directory | Low | Verify at `developers.reddit.com/apps` before submission; reposition differentiator if needed (see §1.3) |
| Bad save corrupts active AutoMod config | Low | Diff preview required before every save; Redis backup before every write; native wiki revision history is the canonical record and is one click to revert |
| Gemini rewrites config instead of appending | Low | Append-only is the default and enforced in the system prompt; rewrite mode requires explicit confirmation and triggers a backup first |
| Privacy Policy / ToS URL not ready by submission deadline | Low | Drafts shipped in Week 1 ahead of first playtest (required by Reddit before the domain review even starts); host on a free static page (GitHub Pages or repo-rendered Markdown); link in app details before final upload |

---

## 11. Post-Hackathon Roadmap

Model A (developer-provided global key with F11 rate limits) is the right call for the hackathon submission window but is not assumed to scale indefinitely. The plan below describes how the billing and cost story evolves after submission, in three phases.

### Phase 1 — Hackathon (Weeks 1–4)

- **Model A.** Single global Google Gemini secret set by the developer via CLI.
- **F11 cost controls** (per-mode daily quotas, kill switch, max-input cap, usage logging) ship as part of MVP.
- Default quotas tuned for an explicit monthly budget the developer is willing to absorb. Tunable via global setting without redeploy.

### Phase 2 — BYO-Key Escape Hatch (Weeks 5–8 post-submission, ~30 LoC)

The smallest possible monetization-adjacent change: let heavy users plug in their own Gemini key per subreddit. Reduces the developer's marginal cost without introducing a payment system.

- Add a subreddit-scoped setting `geminiApiKeyOverride` (plain string, **not** an `isSecret` setting — Devvit secrets cannot be subreddit-scoped). Documented honestly in the privacy disclosure as visible to other mods of that subreddit.
- Server reads override first; if absent, falls back to the global secret.
- When override is present, F11 quotas are bypassed for that subreddit.
- Net effect: free shared tier with quotas (default) or unlimited self-funded tier (mods who care).

### Phase 3 — Devvit IAP for Conflict Check (only if traction warrants it)

Conflict Check on full configs is the dominant cost concentration — long input plus the Pro model plus reasoning workload, capped at 5 calls/sub/day vs 50 for Generate. If the app sees real adoption, the simplest sustainable design is to gate just this one mode behind a Devvit In-App Purchase.

- Free, quota-limited: Generate, Explain.
- Gated: Conflict Check requires either (a) a Phase 2 BYO key or (b) an active Devvit IAP entitlement.
- **Open question:** does Devvit IAP support **subscriptions** (recurring) or only one-time purchases? Does the entitlement attach to the **subreddit** (correct for a mod tool) or to the **user**? These are blocking questions for Phase 3 design and require a pass through Devvit's IAP documentation before committing.
- Reddit Developer Funds engagement payouts may partially offset costs in parallel; don't plan on them as primary revenue.

Phase 3 is intentionally vague because the Devvit IAP capability surface has not been reviewed at the time of writing. It should not be promised in the hackathon submission.
