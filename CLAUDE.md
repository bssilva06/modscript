# CLAUDE.md — ModScript

Project guidance for Claude when working in this repo. Read this before making changes.

> Companion docs: `AGENTS.md` (workspace rules) and `modscript-prd.md` (product spec, v1.5). When this file conflicts with `AGENTS.md`, follow `AGENTS.md` for tooling/style rules and this file for product behavior.

---

## 1. What we're building

**ModScript** is a Devvit Web mod tool that lives inside Reddit's native mod panel. It gives subreddit moderators a conversational AI interface (powered by Gemini) to **Generate**, **Explain**, and **Audit** their AutoModerator YAML configuration without writing YAML or leaving Reddit.

Hackathon: Reddit Mod Tools & Migrated Apps Hackathon (Apr 29 – May 27, 2026). Category: **New Mod Tool**.

> **AI provider note.** Reddit's Devvit policy currently approves only Google Gemini and OpenAI/ChatGPT for hosted apps. ModScript uses **Google Gemini** (`generativelanguage.googleapis.com`). An earlier draft of this PRD targeted Anthropic Claude; that pivot happened before any deploy and is reflected throughout this file.

### Three core modes

| Mode | Purpose | Model |
|---|---|---|
| Generate | Plain English → valid AutoMod YAML, append-only by default | `gemini-2.5-pro` |
| Explain | YAML → rule-by-rule plain English breakdown | `gemini-2.5-flash` |
| Conflict Check | Pattern-based audit: duplicates, redundant rules, suspicious ordering | `gemini-2.5-pro` |

Conflict Check is **structural pattern analysis**, not runtime simulation. UI copy must reflect this — output is framed as "review suggestions," never "rules that will fire."

> Gemini's family has two tiers (Pro and Flash) where the previous Claude design used three (Sonnet/Haiku/Opus). Generate and Conflict Check share `gemini-2.5-pro`; the cost gradient between them is enforced by F11 daily quotas (50 vs 5 calls/sub/day), not by model selection.

---

## 2. Tech stack (this repo)

This project is **Devvit Web**, not Devvit Blocks. The PRD's file layout references the older Blocks API (`Devvit.addMenuItem()`, `src/main.ts`, `src/webview/`, `devvit.yaml`); ignore that and use the layout below.

- **Frontend**: React 19, Tailwind CSS 4, Vite — runs in an iframe on reddit.com
- **Backend**: Node 22 serverless (Devvit), Hono router
- **Server access**: `redis`, `reddit`, `context` from `@devvit/web/server`
- **Client access**: `navigateTo`, `showToast`, `showForm` from `@devvit/web/client`
- **External**: Google Gemini API via `fetch()` from the server

### Directory layout

```
src/
├── client/          # React UI in an iframe
│   ├── splash.html  # Inline view in feed — keep small, no heavy deps
│   ├── splash.tsx
│   ├── game.html    # Expanded view — main app UI
│   └── game.tsx
├── server/          # Hono routes, runs serverless
│   ├── index.ts     # Hono app entry (mounts routes under /api and /internal)
│   ├── routes/
│   │   ├── api.ts        # Public API the client calls (init, mode actions)
│   │   ├── menu.ts       # Menu item handlers (subreddit mod tools)
│   │   ├── forms.ts      # Form submit handlers
│   │   └── triggers.ts   # App lifecycle triggers (onAppInstall, etc.)
│   └── core/        # Domain logic — gemini.ts, wiki.ts, redis.ts, templates.ts go here
└── shared/          # Types shared between client and server
```

**Endpoint registration:** every menu item, form, and trigger must have a matching entry in `devvit.json`. If you add a new endpoint without updating `devvit.json`, it won't fire.

---

## 3. App entry point

The app is launched from a **mod-only menu item** on a subreddit. The expanded UI is the React `game.html` view. Wire it up by:

1. Adding a menu item to `devvit.json` under `menu.items` with `forUserType: "moderator"` and `location: "subreddit"`.
2. Pointing its `endpoint` at a route in `src/server/routes/menu.ts` that creates a post (or navigates to the expanded view).
3. The client `game.tsx` is the React root for the chat + code panel UI.

The default "Create a new post" / "Example form" menu items from the template can be replaced with the ModScript entry point.

---

## 4. MVP feature checklist (must ship)

| ID | Feature | Key behaviors |
|---|---|---|
| F1 | Generate Mode | Append-only by default. Explicit "Rewrite full config" requires confirm + auto-backup. |
| F2 | Explain Mode | Rule-by-rule plain English; uses Gemini 2.5 Flash. |
| F3 | Conflict Check | Pattern heuristics only, not simulation. Uses Gemini 2.5 Pro, gated by a tight daily quota. UI copy: "review suggestions." |
| F4 | Wiki Read/Write | Auto-fetch `config/automoderator` on open. Diff preview before every save. `update(content, reason)` with `runAs: USER`. Redis backup before every write. Native wiki revisions are the canonical history. |
| F5 | Privacy Disclosure | One-time modal on first launch per subreddit; ack stored in Redis. |
| F6 | Starter Templates | 4 templates: General, Gaming, Support/Mental Health, News + "Start blank." |
| F8 | Version History | Revision list modal (last 10 native wiki revisions); one-click revert with Redis backup before reverting. `GET /api/revisions`, `POST /api/revert`. |
| F11 | Cost Controls | Per-mode-per-sub daily quotas in Redis, global `paused` kill switch, max-input-token cap, server-side usage logging. Load-bearing for Model A billing. |

### Stretch (only if time)

- F7 Extended template library (Finance, NSFW, Meme, AMA, Sports)
- F9 Rule Tester sandbox
- F10 Shareable rule snippets

---

## 5. Critical guardrails (do not violate)

These came out of the PRD's risk analysis. Treat them as invariants.

1. **Append is the default everywhere.** Generate Mode and Save flow both append to the existing config. A 400-line hand-tuned config must never be silently rewritten.
2. **Rewrite requires a second click.** The "Rewrite full config" path needs an explicit confirmation dialog and triggers a Redis backup *before* writing.
3. **Every wiki save shows a diff preview first.** Additions in green, removals in red. No save without confirmation.
4. **Every wiki save snapshots the previous config to Redis** *and* writes a meaningful `reason` string into Reddit's native wiki revision history.
5. **Privacy disclosure on first launch.** Mod must acknowledge before any Gemini call. Ack stored in Redis keyed by subreddit.
6. **Conflict Analyzer copy is scoped.** Never claim it predicts which rules fire at runtime. It flags structural patterns for human review.
7. **API key is a developer global secret (Model A).** It lives in `devvit.json` `settings.global.geminiApiKey` with `isSecret: true`, set via `npx devvit settings set geminiApiKey`. Read with `settings.get('geminiApiKey')` on the server only. Never expose it to the client, never hardcode it, never log it. Mods do **not** enter their own key in this build — see PRD §7.3.
8. **Cost controls are non-negotiable.** Every Gemini call is gated by F11: kill-switch check, daily quota check, max-input-token check, then usage log on success. Bypassing any of these is a bug, not a shortcut.
9. **Generated YAML is not validated against AutoMod.** Gemini self-validates via prompt; UI copy advises mods to test on a low-traffic post before relying on a new rule.
10. **Server handlers must complete in 30 seconds.** No streaming, no long-running tasks. Conflict Check on huge configs must be chunked or pre-summarized.

---

## 6. Gemini integration

- **Where it runs:** server-side only, in `src/server/core/gemini.ts`. Client never calls Google directly (the iframe is network-locked to the app's own domain).
- **Auth:** `await settings.get('geminiApiKey')` from `@devvit/web/server`. The value is a Devvit global secret set via CLI (`npx devvit settings set geminiApiKey`). Pass it as the `x-goog-api-key` header on each request.
- **System prompt** includes:
  - The full AutoMod YAML spec and supported fields
  - The subreddit's current config (fetched on load)
  - The subreddit type (from template picker)
  - Mode-specific instructions
  - Output format rules (raw YAML for Generate; structured text for Explain/Conflict)
  - The append-only invariant
- **Conversation history** is stored in Redis per-subreddit and replayed into each call to support multi-turn refinement.
- **Model selection** is per-mode (see table in §1). Don't use one model for everything — Flash for Explain keeps cost down for the most-used path. Generate and Conflict Check both use Pro; the F11 quota differential (50 vs 5 calls/sub/day) is what bounds cost on the reasoning-heavy Conflict Check, since Gemini's tier family doesn't have an Opus-equivalent third rung.
- **`generativelanguage.googleapis.com` must be allow-listed** in `devvit.json` `permissions.http`. Reddit's Devvit allow-list has **no global pre-approval** — every app must request its own domains, even for `devvit playtest`. Approval is reviewed manually (historically Tuesdays, 2+ weeks SLA). Submit on Week 1 day one. Status surfaces on `developers.reddit.com/my/apps`.
- **30-second timeout** applies to the entire handler, including the Gemini round trip. No streaming UIs.

---

## 7. Wiki integration

- Read: `reddit.getWikiPage(subredditName, 'config/automoderator')` returns a `WikiPage` instance.
- Write: `wikiPage.update(content, reason)` — requires the installing mod to have "Manage Wiki Pages" permission. The `reason` string is human-visible in Reddit's native revision history; always pass a meaningful one (e.g., `"ModScript — appended rule: <summary>"`).
- Use `runAs: USER` on writes so the revision is attributed to the moderator, not the app. **Verify support in Week 1** — fall back to writing as the app and surface the actor in a toast if `runAs` isn't supported on `WikiPage.update`.
- Native revision API: `wikiPage.getRevisions()` and `wikiPage.revertTo(revisionId)`. These power the F8 stretch UI directly — no custom version store needed.
- Redis backup before every write: key shape `automod:backup:<subreddit>:<timestamp>`, capped at the last 5 versions. This is a **fast-restore cache and pre-install safety net**, not the canonical history (Reddit's wiki revisions are).

---

## 8. Cost controls (F11) — non-negotiable

Every Gemini call must pass through this gate, in this order:

1. **Kill switch.** `await settings.get('paused')` — if true, return a friendly "temporarily unavailable" toast and abort.
2. **Daily quota.** `INCR quota:<subreddit>:<mode>:<YYYYMMDD>` with a 48-hour `EXPIRE`. If the result exceeds the per-mode cap, return a friendly "daily limit reached" toast and abort.
3. **Max input size.** Reject configs above ~50K tokens with a clear error before building the prompt. Do not call Gemini.
4. **Usage log.** On success, write input/output token counts (from Gemini's `usageMetadata`) and approximate cost to `usage:<subreddit>:<YYYYMMDD>`.

Defaults (read from global settings, tunable without redeploy):

- Generate (Pro): 50/day/sub
- Explain (Flash): 50/day/sub
- Conflict Check (Pro): 5/day/sub

Implementation lives in `src/server/core/quota.ts` (new). Every mode handler in `src/server/routes/api.ts` calls it before invoking `gemini.ts`. There is no per-subreddit override — quotas are global-tunable only.

---

## 9. Required `devvit.json` additions

The scaffold's `devvit.json` does not yet have a `permissions` block or the `settings` block. Both must be added before any Gemini call works:

```json
"permissions": {
  "reddit": true,
  "redis": true,
  "http": {
    "enable": true,
    "domains": ["generativelanguage.googleapis.com"]
  }
},
"settings": {
  "global": {
    "geminiApiKey":    { "type": "string", "isSecret": true, "label": "Google Gemini API Key" },
    "paused":          { "type": "boolean", "label": "Pause all AI calls", "defaultValue": false },
    "quotaGenerate":   { "type": "number", "label": "Generate calls/day/sub", "defaultValue": 50 },
    "quotaExplain":    { "type": "number", "label": "Explain calls/day/sub",  "defaultValue": 50 },
    "quotaConflict":   { "type": "number", "label": "Conflict calls/day/sub", "defaultValue": 5 },
    "maxInputTokens":  { "type": "number", "label": "Max input tokens per call", "defaultValue": 50000 }
  }
}
```

> Schema gotchas (v1): `permissions.http` is an **object** with `enable` + `domains`, not a bare array. Setting fields use `defaultValue` (not `default`); `additionalProperties: false` rejects extras silently with a oneOf-mismatch error. Secret string settings (`isSecret: true`) must NOT include `defaultValue`.

The Gemini key is set out-of-band: `npx devvit settings set geminiApiKey`. It is never edited via UI.

---

## 10. Personas to design for

- **The Inheritor** — inherited a 500-line config they didn't write. Primary use case: Explain Mode + Conflict Check.
- **The Founder** — new subreddit, never written YAML. Primary use case: template picker + Generate Mode.
- **The Power Mod** — moderates 15+ subreddits. Primary use case: fast iteration in Generate Mode, Shareable Snippets (stretch).

---

## 11. Commands

From `package.json`:

- `npm run dev` — `devvit playtest` for live development on Reddit
- `npm run build` — Vite build of client + server
- `npm run type-check` — `tsc --build`
- `npm run lint` — ESLint over `src/**/*.{ts,tsx}`
- `npm run test` — Vitest (use `npm run test -- <file>` to scope to one file)
- `npm run deploy` — type-check + lint + test + `devvit upload`
- `npm run launch` — deploy + `devvit publish`
- `npm run login` — `devvit login`

After substantive edits, run `npm run type-check` and `npm run lint`. Fix any errors introduced.

---

## 12. Code style (from AGENTS.md)

- TypeScript: prefer **type aliases** over interfaces.
- Prefer **named exports** over default exports.
- **Never cast** TypeScript types — fix the type instead.
- Do **not** use `@devvit/public-api` or Devvit Blocks code. This project is Devvit Web only.
- In the client, never use `window.location` / `window.assign` — use `navigateTo` from `@devvit/web/client`.
- No `window.alert` — use `showToast` or `showForm`.
- No inline `<script>` tags in HTML files — use a separate `.ts`/`.tsx` and import it.
- No file downloads — use the clipboard API + `showToast` to confirm.
- Comments should explain non-obvious intent, never narrate what the code does.

---

## 13. Out of scope (do not build for hackathon submission)

- Multi-language support
- Mobile optimization (Devvit mod tools are desktop-only)
- Analytics dashboard
- Cross-subreddit rule syncing
- Rule Tester / Sandbox (stretch only)
- Templates beyond the 4 MVP types

---

## 14. Submission checklist (Week 4)

- [x] All three modes work end-to-end with no crashes (Generate/Explain/Conflict all implemented)
- [x] Privacy disclosure appears on first launch and is dismissible once (per-subreddit ack in Redis)
- [x] Diff preview appears before every wiki save; saves include a meaningful `reason`
- [x] Wiki writes attributed to the moderator via `runAs: USER` (fallback: writes as app via `reddit.updateWikiPage`; `runAs` not yet verified with Devvit's wiki API — confirm in playtest)
- [x] Redis backup is written before every wiki update (5 backups, 90-day retention)
- [x] Append-only is enforced; rewrite requires explicit confirmation (amber-banner diff modal)
- [x] F11 cost controls live: quota gate, kill switch, max-input-token cap, usage logging
- [ ] App is installable from the App Directory in one click (zero setup — Model A)
- [x] `generativelanguage.googleapis.com` admin review approved (auto-approved on first deploy)
- [x] **README includes "Fetch Domains" section** listing every external domain and why
- [ ] **Privacy Policy URL and Terms of Service URL** published and linked in app details
- [ ] Demo video (<3 min) follows the shot list in PRD §8.1
- [ ] App Directory verified at `developers.reddit.com/apps` for differentiator claim
- [x] Version history UI (F8): revision list + one-click revert
