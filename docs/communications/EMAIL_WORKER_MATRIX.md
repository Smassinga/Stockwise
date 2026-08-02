# Email worker matrix

| Worker | Caller | Queue | Control | Retry evidence | Template families |
|---|---|---|---|---|---|
| due-reminder-worker | scheduled/custom-secret worker | due reminder queue | worker secret; no browser service key | attempts, next attempt, stale-processing recovery, terminal failure | Sales Order and Sales Invoice reminders |
| digest-worker | scheduled/custom-secret worker | digest queue/state | worker secret | attempts, next attempt, stale-processing recovery, terminal failure | daily digest |
| mailer-invite | Users workflow | invitation authority | authenticated JWT, MANAGER+ | mail dispatch event | member invite |
| mailer-report | no active production caller found; dormant but retained | none | authenticated JWT, MANAGER+ | mail dispatch event | report ready |
| mailer-company-access | Platform Control | none | authenticated JWT, platform admin | mail dispatch event | expiry, purge, activation |
| email-template-lab | Platform Control | none | authenticated JWT, platform admin, rate limit, recipient allowlist | mail dispatch event | synthetic QA only |

Required secret names are verified during deployment without printing values. Application templates are source controlled; provider evidence stores metadata and message IDs, never rendered HTML. Supabase Auth templates are audited separately and are not exercised against an existing user account.

Hosted version, queue counts, oldest pending job, last success/failure, schedules, and deployment IDs belong in the rollout evidence because they are environment state rather than source constants.

COMMS-3 adds the central sender resolver to every application worker. `due-reminder-worker` consumes the adaptive batch, atomically reserves a durable stage, performs a final authoritative eligibility read, sends, and links provider acceptance to the stage and private dispatch row. Company communication profiles are OWNER/ADMIN managed; the verified StockWise sender domain and provider transport remain platform controlled.

COMMS-3C adds a second final eligibility barrier for collection state. `paused`, `disputed`, `promise_to_pay`, and `manual_follow_up` exposures are recorded as governed skips and never reach the provider. Pending stages are superseded on a control transition, while accepted history remains immutable. Promise evaluation and follow-up notifications use company-local dates and current settlement/credit evidence.
