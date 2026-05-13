export const DEMO_AUTOMOD_CONFIG = `---
# Demo: report suspicious shortened links without removing content.
type: submission
url+body (regex, includes): ['bit\\.ly/', 'tinyurl\\.com/', 't\\.co/[^\\s]+']
action: report
action_reason: "Demo: suspicious shortened link"
---
# Demo: hold very new accounts for review.
type: any
author:
  account_age: "< 3 days"
action: filter
action_reason: "Demo: account younger than 3 days"
---
# Demo: require post flair on submissions.
type: submission
is_edited: false
~flair_text (regex): ".+"
action: remove
comment: |
  Please add a post flair before submitting again.
action_reason: "Demo: missing post flair"
---
# Demo: remove common spam phrase clusters.
type: submission
body+title (regex, includes): ['(?i)free\\s+crypto', '(?i)guaranteed\\s+profit', '(?i)dm\\s+me\\s+for\\s+rates']
action: remove
action_reason: "Demo: common spam phrase"
---
# Demo: alert mods when low-karma comments mention giveaways.
type: comment
body (regex, includes): ['(?i)giveaway', '(?i)airdrop', '(?i)limited\\s+offer']
author:
  combined_karma: "< 25"
action: report
action_reason: "Demo: low-karma giveaway comment"
`;
