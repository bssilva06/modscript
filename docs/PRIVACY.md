# Privacy Policy — ModScript

**Effective date:** 05/01/2026
**Last updated:** 05/01/2026
**App name:** ModScript
**App developer / contact:** Benjamin Silva — bsabinosilva22@gmail.com

---

## 1. Who this policy applies to

This policy describes how ModScript (the "App") handles information when a subreddit moderator uses it from inside Reddit's mod panel. It applies only to the App itself. It does not cover Reddit's own data practices ([reddit.com/policies/privacy-policy](https://www.reddit.com/policies/privacy-policy)) or Google's data practices for the Gemini API ([policies.google.com/privacy](https://policies.google.com/privacy)).

The App is a moderator tool. Only users with moderator permissions on a subreddit can launch it on that subreddit.

## 2. What information the App handles

The App is designed to handle the **minimum** information needed to do its job. Specifically:

**Information sent to the App's server:**
- Your moderator-typed prompts and messages (the conversation you have with the AI inside the app).
- The current contents of your subreddit's `config/automoderator` wiki page, fetched on the App's behalf when you open it.
- The subreddit name and your Reddit username, provided by Reddit's Devvit platform so the App knows which subreddit it is acting on and who is acting.

**Information stored by the App in Reddit-managed Redis:**
- A short conversation history per subreddit, so multi-turn refinement works (e.g., "now make that rule case-insensitive").
- Up to 5 prior versions of your AutoModerator config, captured before each save as a fast-restore safety net. (The canonical version history lives in Reddit's native wiki revisions, not here.)
- Per-subreddit, per-mode daily request counts, used to enforce daily quotas.
- Approximate token counts and cost estimates for each call, used internally for cost monitoring.
- A flag recording that you have acknowledged the privacy disclosure shown on first launch.

**Information sent to Google (Gemini API):**
- Your typed prompts and messages.
- The current AutoModerator YAML config (so the AI can append, explain, or audit against it).
- Earlier turns of the current conversation when relevant.

The App **does not** collect or transmit:
- Any post content, comment content, or user content from your subreddit other than the AutoModerator config itself.
- Any personal information beyond the public Reddit username of the moderator using the App.
- Any payment information, device identifiers, location data, or analytics/tracking data.
- Any cookies on Reddit's domain. (The App runs in a sandboxed iframe inside Reddit and does not set cookies.)

## 3. How information is used

The App uses the information described above only to:

1. Answer your AI request in the mode you selected (Generate, Explain, or Conflict Check).
2. Show you a diff preview before any wiki save and write the change to your subreddit's wiki, attributed to you.
3. Enforce daily usage quotas and a global kill switch to keep AI costs bounded and prevent abuse.
4. Recover from accidental writes (the Redis backup of your previous config).

The App does not use your data to train any AI model. The App developer does not sell, rent, or share your data with anyone other than the third-party processor described in section 4.

## 4. Third-party processors

**Google (Gemini API).** Your prompts and your AutoModerator YAML are sent to Google's Gemini API endpoint at `generativelanguage.googleapis.com` for the AI to process. Google's handling of API inputs is governed by Google's API terms and privacy policy:
- [Google Privacy Policy](https://policies.google.com/privacy)
- [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)

**Reddit (Devvit platform).** The App runs inside Reddit's Devvit infrastructure. Reddit operates the iframe sandbox, the Redis store, and the wiki itself. Reddit's handling of this data is governed by:
- [Reddit Privacy Policy](https://www.reddit.com/policies/privacy-policy)
- [Devvit Terms](https://developers.reddit.com/docs/legal/devvit-terms)

The App developer is not a separate data controller for Reddit's underlying infrastructure.

## 5. Retention

- **Conversation history in Redis:** retained on a rolling basis per subreddit; older turns are dropped as the conversation grows.
- **Config backups in Redis:** capped at the most recent 5 per subreddit; older backups are overwritten.
- **Quota counters in Redis:** keyed per UTC day with a 48-hour expiry; older counters are deleted automatically.
- **Usage logs in Redis:** keyed per UTC day; retained for 30 days, then deleted automatically.
- **Privacy disclosure ack:** retained for the lifetime of the App's installation on your subreddit.
- **Wiki revisions:** controlled by Reddit's native wiki revision system, not by the App.
- **Data sent to Google:** retention is governed by Google's API terms (link in section 4).

If you uninstall the App from your subreddit, the App stops accessing your subreddit's Redis data. Quota counters expire automatically (48 hours), conversation history is rolling, and config backups rotate out at 5 entries per subreddit. The App does not currently auto-purge all Redis keys on uninstall; you may request explicit deletion of any remaining data via the contact address below.

## 6. Your rights and choices

- **Decline to use the App.** The App only runs when a moderator opens it. If you do not open it, no data is sent.
- **Withdraw the privacy disclosure ack.** There is currently no in-app reset for the disclosure ack. To re-show the disclosure, uninstall and reinstall the App on your subreddit; the disclosure will appear again on next launch.
- **Request deletion of App-stored data.** Contact bsabinosilva22@gmail.com. The App developer will, where technically feasible, delete the App's Redis data for the subreddit you specify within 30 days. Note that wiki revisions and any data already processed by Google are outside the App developer's control.
- **Reddit and Google rights.** For data held by Reddit or Google, exercise your rights through their respective privacy contacts (links in section 4).

## 7. Security

The Gemini API key used by the App is held as a Devvit-managed global secret and is read only on the server. It is never sent to the iframe, never logged, and never exposed to moderators or end users. All AI calls happen on the App's server inside Reddit's Devvit infrastructure; the iframe communicates with the server only via Reddit-mediated HTTPS.

No system is perfectly secure. The App developer makes no warranty of absolute security.

## 8. Children's privacy

The App is intended for use by Reddit subreddit moderators. Reddit's own terms require users to be 13+. The App developer does not knowingly process information from anyone under that age.

## 9. International use

The App's server runs on Reddit's Devvit infrastructure. The Gemini API is operated by Google, primarily from servers in the United States. By using the App, you understand that your prompts and AutoMod config may be processed in the United States and other countries where Google operates.

## 10. Changes to this policy

The App developer may update this policy. Material changes will be reflected by updating the "Last updated" date above and, where practical, by surfacing a notice in the App on next launch.

## 11. Contact

bsabinosilva22@gmail.com
