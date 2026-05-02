# ModScript

A Reddit Devvit Web mod tool that lives in the native subreddit mod panel. It gives moderators a conversational AI interface to **Generate**, **Explain**, and **Audit** their `AutoModerator` YAML configuration without writing YAML or leaving Reddit.

> Built for the **Reddit Mod Tools & Migrated Apps Hackathon** (Apr 29 – May 27, 2026), category: New Mod Tool.

## Three modes

| Mode | What it does |
|---|---|
| **Generate** | Plain-English request → valid AutoMod YAML. Append-only by default; full rewrites require explicit confirmation and snapshot the previous config to a Redis backup first. |
| **Explain** | Existing YAML → rule-by-rule plain-English breakdown. |
| **Conflict Check** | Pattern-based audit for duplicates, redundant rules, and suspicious ordering. Output is framed as **review suggestions** — this is structural pattern analysis, not runtime simulation, and never claims to predict which rules will fire. |

Every wiki save shows a **diff preview** (additions in green, removals in red) and writes a meaningful `reason` string into Reddit's native wiki revision history. A Redis backup of the previous config is captured before every write (last 5 retained per subreddit).

## Tech stack

- **Frontend:** React 19, Tailwind CSS 4, Vite — runs in an iframe inside Reddit's mod panel
- **Backend:** Node 22 serverless (Devvit Web), Hono router
- **AI:** Google Gemini API (server-side only, gated by per-subreddit daily quotas and a global kill switch)
- **Storage:** Reddit Wiki (canonical config history via `wikiPage.getRevisions()`) + Redis (fast-restore backups, conversation history, quota counters, usage logs, privacy-disclosure acks)

## Fetch Domains

This app makes outbound HTTP calls to **one** external domain. Per Reddit's Devvit allow-list policy, this domain is declared in `devvit.json` under `permissions.http` and is subject to admin approval.

| Domain | Why it's needed | What flows through it |
|---|---|---|
| `generativelanguage.googleapis.com` | Google Gemini REST API endpoint. The app's three modes (Generate / Explain / Conflict Check) all call Gemini server-side from within `src/server/core/`. The client iframe **never** calls this domain directly — the API key is held as a Devvit global secret and is only ever read on the server. | The subreddit's current AutoModerator YAML config (already public via the subreddit's wiki), the moderator's typed prompts/messages, and prior turns of the same conversation (stored in Redis, replayed for multi-turn refinement). No Reddit account credentials, no PII beyond the moderator's public Reddit username, and no content from posts/comments outside the AutoMod config itself. |

**Cost & abuse controls (F11):** every Gemini call passes through a four-step gate before reaching the network — a global kill switch, a per-subreddit-per-mode daily quota, a max-input-token cap, and post-call usage logging. The defaults (Generate 50/day, Explain 50/day, Conflict 5/day) are tunable via global app settings without redeploy. The Gemini API key is a developer-provided global secret (set via `npx devvit settings set geminiApiKey`); moderators do not enter their own key.

## Privacy & Terms

- [Privacy Policy](docs/PRIVACY.md)
- [Terms of Service](docs/TERMS.md)

> Both documents are drafts pending review and hosting. Public URLs will be added to the app's Developer Settings page before playtest.

## Local development

> Requires Node ≥ 22.2 and a Reddit account connected at [developers.reddit.com](https://developers.reddit.com/).

```sh
npm install
npm run login        # one-time: log the Devvit CLI into Reddit
npm run dev          # devvit playtest — live development on a test subreddit
```

Other commands:

| Command | Purpose |
|---|---|
| `npm run type-check` | `tsc --build` |
| `npm run lint` | ESLint over `src/**/*.{ts,tsx}` |
| `npm run test` | Vitest |
| `npm run build` | Vite build of client + server |
| `npm run deploy` | Type-check + lint + test + `devvit upload` |
| `npm run launch` | Deploy + `devvit publish` |

## Project documentation

- [`CLAUDE.md`](CLAUDE.md) — operating manual for AI assistants working in this repo (guardrails, F11 cost controls, wiki integration, file layout)
- [`AGENTS.md`](AGENTS.md) — workspace tech-stack rules
- [`docs/modscript-prd.md`](docs/modscript-prd.md) — full Product Requirements Document
- [`docs/devvit_docs.md`](docs/devvit_docs.md) — compressed Devvit Web reference

## License

BSD-3-Clause. See [`LICENSE`](LICENSE).
