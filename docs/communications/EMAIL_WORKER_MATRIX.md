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
