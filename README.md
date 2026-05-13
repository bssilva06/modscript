# ModScript

> **AI-powered AutoModerator assistant, native to Reddit's mod panel.**

[![Hackathon](https://img.shields.io/badge/Hackathon-Reddit%20Mod%20Tools%20%26%20Migrated%20Apps-FF4500?style=flat-square)](https://developers.reddit.com)
[![Category](https://img.shields.io/badge/Category-New%20Mod%20Tool-orange?style=flat-square)](https://developers.reddit.com)
[![Platform](https://img.shields.io/badge/Platform-Devvit%20Web-blue?style=flat-square)](https://developers.reddit.com)
[![AI](https://img.shields.io/badge/AI-Google%20Gemini%202.5-4285F4?style=flat-square)](https://ai.google.dev)

---

## The Problem

AutoModerator is the backbone of Reddit moderation — yet writing and maintaining its YAML configuration is one of the highest barriers for mod teams:

- **Most moderators are not developers.** YAML syntax is error-prone and poorly documented.
- **Inherited configs are black boxes.** A 400-line file written by someone who left the mod team two years ago is terrifying to touch.
- **Configs rot.** Over time they accumulate dead rules, duplicate conditions, and ordering issues that nobody catches.
- **Every existing AI tool requires leaving Reddit.** Copy YAML out, paste into a website, copy back. Repeat for every change.

There is no AI-native AutoMod tool built into Reddit's platform — until now.

---

## What ModScript Does

ModScript lives inside Reddit's native mod panel as a Devvit app. Moderators open it directly from their subreddit's mod tools menu and get a **conversational AI interface** — powered by Google Gemini — to generate, explain, and audit their AutoModerator config without writing a single line of YAML and without ever leaving Reddit.

### Three Core Modes

| Mode | What it does | AI Model |
|---|---|---|
| **Generate** | Plain English → valid AutoMod YAML, appended safely to your existing config | Gemini 2.5 Pro |
| **Explain** | Paste a YAML block → rule-by-rule plain English breakdown | Gemini 2.5 Flash |
| **Conflict Check** | Structural audit: duplicate rules, redundant conditions, suspicious ordering | Gemini 2.5 Pro |

---

## Who It's For

ModScript is designed around three real moderator personas:

**"The Inheritor"**
Became a mod of an existing subreddit. Has a 500-line AutoMod config written by someone else years ago, no idea what half the rules do, and is afraid to touch them.
*Primary use: Explain Mode + Conflict Check.*

**"The Founder"**
Started a new subreddit that is growing. Knows they need AutoMod but has never written YAML and doesn't know where to start.
*Primary use: Template picker + Generate Mode.*

**"The Power Mod"**
Moderates 15+ subreddits. Needs to quickly iterate and adapt rule sets without a learning curve.
*Primary use: Generate Mode with multi-turn refinement.*

---

## Features

### Generate Mode
Type a plain English description of a rule. ModScript generates valid, formatted AutoMod YAML and displays it in a syntax-highlighted code panel.

- **Append-only by default** — generated rules are added to the bottom of your existing config. A 400-line hand-tuned config is never silently overwritten.
- **Multi-turn refinement** — follow up in the same conversation to adjust scope, conditions, or phrasing.
- **Explicit rewrite mode** — a clearly labeled "Rewrite full config" option is available behind a confirmation dialog. Triggers an automatic Redis backup before any change is made.

### Explain Mode
Load your existing config (fetched automatically on open) or paste any YAML block. ModScript returns a structured, rule-by-rule breakdown in plain English — what triggers each rule, what action it takes, and edge cases to watch for.

Powered by **Gemini 2.5 Flash** to keep latency low on the most-used path.

### Conflict Check
Submit your full AutoMod config. ModScript analyzes it for:

- Duplicate keyword lists across multiple rules
- Rules with identical triggers that could be merged
- Suspicious action ordering (e.g., approve before remove)
- Structurally redundant conditions

Output is framed as **review suggestions** — structural pattern analysis for a human mod to evaluate, not a claim about which rules fire at runtime.

### Wiki Read/Write with Guardrails
- **Auto-fetches** the subreddit's `config/automoderator` wiki page on open — no copy/pasting required.
- **Diff preview before every save** — additions in green, removals in red. No save without explicit confirmation.
- **Meaningful revision history** — every save writes a human-readable reason string to Reddit's native wiki revision history (e.g., `"ModScript — appended rule: remove posts from accounts under 3 days old"`).
- **Redis backup before every write** — previous config snapshotted immediately before any wiki update, with the last 5 backups retained per subreddit.

### Privacy Disclosure
A one-time modal on first launch per moderator per subreddit explains that AutoMod configurations are sent to Google's Gemini API for processing. Acknowledgement is stored in Redis per Reddit username and subreddit, so every moderator sees and accepts the disclosure for themselves.

### Starter Templates
On first open, mods choose a subreddit type to pre-load a sensible starting config, or start blank:

| Template | Best For |
|---|---|
| **General** | Mixed-content communities |
| **Gaming** | Gaming subreddits and tournament communities |
| **Support / Mental Health** | Communities requiring stricter content standards |
| **News** | News aggregation and discussion communities |
| **Start blank** | Building from scratch |

### Version History
A revision list modal showing the last 10 native Reddit wiki revisions, each with timestamp, author, and reason string. One-click revert to any prior revision, with a Redis backup taken before reverting.

Built directly on Reddit's native `wikiPage.getRevisions()` and `wikiPage.revertTo()` APIs — no custom version store required.

### Cost Controls (F11)
Because the developer's shared Gemini key funds all usage, cost controls are non-negotiable infrastructure built into every AI call:

| Control | Behavior |
|---|---|
| **Kill switch** | Global `paused` setting — halts all Gemini calls instantly across every subreddit |
| **Daily quotas** | Generate: 50/day/sub · Explain: 50/day/sub · Conflict Check: 5/day/sub. Quota increments only after a successful Gemini response. |
| **Max input size** | Configs above ~50K tokens are rejected before any API call is made |
| **Usage logging** | Token counts written to Redis per subreddit per day, retained for 48 hours during the hackathon window |

All quotas are tunable via global settings without redeploying. For the hackathon submission, the developer-provided shared Gemini key keeps judging friction low; the 48-hour usage log retention is intentionally short and exists only to monitor cost and reliability during the judging period.

---

## Safety Guarantees

> ModScript treats your existing AutoMod config as irreplaceable. Every decision in the save flow reflects this.

- **Append is always the default.** A 400-line config is never silently rewritten.
- **Diff preview is mandatory.** Every save shows exactly what will change before committing.
- **Redis backup before every write.** Fast-restore snapshot taken immediately before each wiki update.
- **Reddit's native revision history** is the canonical record — visible in the wiki's revision log, one-click revertible from within ModScript.
- **Conflict Check copy is scoped.** Output is structural pattern analysis for human review, never a claim about which rules fire at runtime.
- **Privacy disclosure on first launch.** No AI calls happen until the mod has acknowledged what data is sent to Gemini.

---

## Architecture

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
│  │ gemini.ts│ │wiki.ts│ │quota.ts│ │
│  │ (core)   │ │ (core)│ │ (core) │ │
│  └────┬─────┘ └───┬───┘ └───┬────┘ │
└───────│────────────│──────────│──────┘
        │            │          │
   Google Gemini  reddit API   Redis
   (fetch)    (getWikiPage/  (quotas,
              updateWikiPage)  backups,
                              history)
```

### Tech Stack

| Layer | Technology |
|---|---|
| Platform | Devvit Web (`@devvit/web`) |
| Language | TypeScript 5.9 |
| Runtime | Node 22 serverless |
| Frontend | React 19 + Tailwind CSS 4 + Vite 7, iframe on reddit.com |
| Backend | Hono 4 router via `@devvit/web/server` |
| AI — Generate | `gemini-2.5-pro` |
| AI — Explain | `gemini-2.5-flash` |
| AI — Conflict Check | `gemini-2.5-pro` |
| Storage | Devvit Redis |
| Reddit API | `reddit`, `context` from `@devvit/web/server` |

### Project Layout

```
src/
├── client/
│   ├── game.html / game.tsx     # Main expanded app UI (chat + code panel)
│   ├── splash.html / splash.tsx # Inline feed view (minimal)
│   └── yamlHighlight.tsx        # YAML syntax highlighting
├── server/
│   ├── index.ts                 # Hono app entry
│   ├── routes/
│   │   ├── api.ts               # Public endpoints called by the iframe
│   │   ├── menu.ts              # Mod tools menu handler
│   │   ├── forms.ts             # Form submit handlers
│   │   └── triggers.ts          # onAppInstall lifecycle trigger
│   └── core/
│       ├── gemini.ts            # Gemini API calls + mode-specific prompts
│       ├── wiki.ts              # AutoMod wiki read/write + Redis backup
│       ├── quota.ts             # F11 cost controls (kill switch, quotas, logging)
│       ├── templates.ts         # Starter config YAML by subreddit type
│       └── post.ts              # Post creation helper
└── shared/
    └── api.ts                   # Shared types (client ↔ server)
```

---

## Hackathon Fit

**Category: New Mod Tool** — Reddit Mod Tools & Migrated Apps Hackathon (Apr 29 – May 27, 2026)

Based on a review of the Devvit App Directory and Devvit community, no AI-native AutoMod tool with Generate + Explain + Conflict Check modes exists natively on Reddit's platform.

| Judging Criterion | How ModScript Addresses It |
|---|---|
| **Community Impact** | Removes the #1 barrier to AutoMod adoption — you no longer need to know YAML |
| **Time Savings** | Eliminates hours of trial-and-error per rule; explains inherited configs in seconds |
| **Polish** | Native Devvit UI, direct wiki integration, zero external tools, zero copy/pasting |
| **Reliable UX** | One-click install from the App Directory, zero config required, zero API key setup for the mod |
| **Ecosystem Impact** | First AI-native AutoMod tool with bidirectional YAML↔English translation and structural conflict analysis in the Devvit App Directory |

---

## User Flows

### First-Time Mod

```
1. Install ModScript from the App Directory — no API key setup required
2. Subreddit mod tools menu → click "ModScript"
3. Privacy disclosure modal → acknowledge once
4. App auto-fetches existing AutoMod config
5. Template picker: choose General / Gaming / Support / News / Start blank
6. Chat with Gemini to build or refine rules (append-only by default)
7. "Save to Wiki" → diff preview → confirm → wiki updated + Redis backup
```

### Returning Mod

```
1. Open "ModScript" from mod tools
2. Current live config loads automatically
3. Pick mode: Generate / Explain / Conflict Check
4. Iterate in the chat panel
5. Save or discard
```

---

## Fetch Domains

> **Required disclosure for Devvit app submission.** This section lists every external domain the app contacts and the reason it is required.

| Domain | Why it's needed | What flows through it |
|---|---|---|
| `generativelanguage.googleapis.com` | Google Gemini REST API — all AI calls (Generate, Explain, Conflict Check) run server-side against this endpoint. The client iframe cannot reach it directly. | The subreddit's current AutoModerator YAML config (already public via the subreddit's wiki), the moderator's typed prompts/messages, and prior turns of the same conversation (stored in Redis, replayed for multi-turn refinement). No Reddit account credentials, no user PII beyond the moderator's public Reddit username, and no content from posts or comments outside the AutoMod config itself. |

No other external domains are contacted. All Reddit API calls and Redis operations use Devvit's built-in server SDKs (`@devvit/web/server`), which do not count as external HTTP.

**API key:** The Gemini key is a developer-provided global secret (`isSecret: true` in `devvit.json`), set once via `npx devvit settings set geminiApiKey`. It is encrypted by Devvit, never returned to the client, never logged, and never visible in any UI. Moderators who install the app do not enter or manage any key.

---

## Privacy & Terms

- [Privacy Policy](docs/PRIVACY.md)
- [Terms of Service](docs/TERMS.md)

> Both documents are hosted and linked in the app's Developer Settings page. Drafts are published before any playtest per Reddit's Devvit domain-approval policy.

---

## Local Development

Requires Node ≥ 22 and a Reddit account connected at [developers.reddit.com](https://developers.reddit.com/).

```sh
npm install
npm run login        # one-time: authenticate the Devvit CLI
npm run dev          # devvit playtest — live development on a test subreddit
```

| Command | Purpose |
|---|---|
| `npm run type-check` | `tsc --build` |
| `npm run lint` | ESLint over `src/**/*.{ts,tsx}` |
| `npm run test` | Vitest |
| `npm run build` | Vite build of client + server |
| `npm run deploy` | Type-check + lint + test + `devvit upload` |
| `npm run launch` | Deploy + `devvit publish` (publishes to App Directory) |

---

## Post-Hackathon Roadmap

**Phase 2 — BYO-Key Escape Hatch**
Subreddits with heavy usage can supply their own Gemini API key per subreddit. When present, F11 quotas are bypassed for that subreddit. Reduces developer cost without a payment system.

**Phase 3 — Devvit IAP for Conflict Check**
If adoption warrants it, gate Conflict Check (the dominant cost driver: long input + Pro model + reasoning) behind an optional Devvit In-App Purchase, while keeping Generate and Explain free with quotas.

**Stretch Features (not in current build)**
- Extended template library (Finance, NSFW, Meme, AMA, Sports)
- Rule Tester / Sandbox — simulate which rules fire on a sample post
- Shareable rule snippets — export individual rules for cross-community sharing

---

## Project Docs

- [`CLAUDE.md`](CLAUDE.md) — operating manual for AI assistants working in this repo
- [`docs/modscript-prd.md`](docs/modscript-prd.md) — full Product Requirements Document (v1.5)
- [`docs/devvit_docs.md`](docs/devvit_docs.md) — compressed Devvit Web API reference

---

**Built by Ben Silva** · Reddit Mod Tools & Migrated Apps Hackathon 2026
