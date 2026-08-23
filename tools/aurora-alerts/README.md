# Aurora alerts

Signup + conditional alert sender for both dashboards.
Worker: `https://aurora-alerts.blomblog.workers.dev`

Separate from `up906-mdot-proxy` on purpose. That one is a public read-only
CORS proxy both dashboards depend on for live data; this one holds subscriber
PII, an email-sending key and a cron trigger. A bad deploy here cannot take the
dashboards' data feeds down.

## What it does

| Route | Purpose |
|---|---|
| `POST /subscribe` | `{email, region}` → store as `pending`, send confirmation link |
| `GET /confirm?t=` | activate — the only status that receives alerts |
| `GET /unsubscribe?t=` | one-click unsubscribe |
| `GET /stats` | counts and recent alerts. **Counts only, never addresses** |
| `GET /run-alerts?key=` | admin-only manual run, see Testing |
| cron | 22:00 and 01:00 UTC — 6 PM and 9 PM Eastern |

## When it actually sends

Both gates must open, per region:

1. **Tonight's forecast Kp clears that region's threshold** — `up` needs Kp 5,
   `nlp` needs Kp 6. The Upper Peninsula sits near 55–57° geomagnetic latitude;
   Northern Lower Michigan is about a degree and a half south, roughly one Kp
   level in practice. Sending UP-grade alerts to Up North subscribers would be
   sending them outside to look at nothing.
2. **At least one of that region's five viewing spots is under 60% cloud.**
   Live NWS gridpoint `skyCover`, averaged over 10 PM – 2 PM local.

Then an 18-hour cooldown per region, so a three-night storm produces three
emails rather than thirty. The two daily crons are "check twice, send at most
once a night" — the first favourable pass wins and the second is a no-op.

Thresholds match the FAIR/GOOD boundary on each site's own aurora page, so the
email and the page can never contradict each other.

## Setup

### 1. Resend API key

```bash
cd tools/aurora-alerts
npx wrangler secret put RESEND_API_KEY
```

### 2. Verify the sending domains in Resend

Add **`906dashboard.com`** and **`upnorthdashboard.com`** — the root domains.

This is safe alongside the live IONOS mail, which is worth spelling out because
it looks like it shouldn't be. Resend does not ask you to modify any root mail
record. It asks for:

| Record | Name | Why it's safe |
|---|---|---|
| `MX` | `send.<domain>` | a **subdomain** MX for bounce feedback — the root MX is untouched |
| `TXT` | `send.<domain>` | SPF scoped to that same subdomain, so the root SPF is untouched |
| `TXT` | `resend._domainkey.<domain>` | a uniquely-named DKIM selector that cannot collide with IONOS's `s1-ionos._domainkey` / `s2-ionos._domainkey` |

A domain may only carry one root SPF record, and merging Resend into IONOS's
`v=spf1 include:_spf-us.ionos.com ~all` would be the dangerous move. Resend
avoids that entirely by scoping to `send.` — so nothing about inbound mail,
root SPF, DKIM or DMARC changes.

Add those three records per domain at IONOS. Verification usually completes
within about 15 minutes.

**Do not touch:** root `MX`, root `TXT` SPF, `_dmarc`, `s1-ionos._domainkey`,
`s2-ionos._domainkey`, `autodiscover`, or `NS`.

Senders are `aurora@906dashboard.com` and `aurora@upnorthdashboard.com`, which
are real IONOS mailboxes — so replies to an alert reach a human instead of
bouncing. Change them in `wrangler.toml` if that ever moves.

### 3. Deploy

```bash
npx wrangler deploy
```

## Testing

`/run-alerts` accepts an admin key and two overrides, so the whole pipeline can
be exercised on a quiet night instead of waiting months for a storm:

```bash
# Real conditions — what the cron would do right now
curl "https://aurora-alerts.blomblog.workers.dev/run-alerts?key=$ADMIN_KEY"

# Force the Kp gate open to exercise the cloud lookups and subscriber query.
# Still cannot send unless real active subscribers exist.
curl "https://aurora-alerts.blomblog.workers.dev/run-alerts?key=$ADMIN_KEY&forceKp=7"

# Also bypass the 18-hour cooldown
curl "...&forceKp=7&ignoreCooldown=1"
```

The response is a per-region summary showing which gate stopped it.

To prove the Resend side without mailing the list, send one alert-shaped
message to a single address:

```bash
curl "https://aurora-alerts.blomblog.workers.dev/test-send?key=$ADMIN_KEY&to=you@example.com&region=up"
```

Read the failure mode: HTTP **401** means the API key is wrong; **403** means
the key is fine but that sending domain is not verified yet.

## Database

D1, `aurora-alerts` (`2298fb19-130d-49cf-aaa3-f0e338ef657d`).

```bash
npx wrangler d1 execute aurora-alerts --remote \
  --command="SELECT region, status, COUNT(*) FROM subscribers GROUP BY region, status;"

npx wrangler d1 execute aurora-alerts --remote \
  --command="SELECT * FROM alert_log ORDER BY sent_at DESC LIMIT 10;"
```

Schema is in `schema.sql`; re-running it is safe (`IF NOT EXISTS` throughout).

### The old FormSubmit list — imported 2026-08-23

The three addresses from `aurora-subscribers.csv` are in, as `region=up`,
`status=active`, each with a unique unsubscribe token. Their original
`first_submitted` dates were carried into `confirmed_at` rather than backdated
to the import date, so the consent record stays truthful.

All three are the owner's own addresses, so they double as the end-to-end test
list for the first real send.

**D1 is now the source of truth.** `aurora-subscribers.csv` is a historical
snapshot only — it is gitignored, and nothing reads it any more. Signups and
unsubscribes after this date exist only in the database.

## Compliance notes

- **Double opt-in.** Signup stores `pending` and mails a confirmation link.
  Nothing is mailable until that link is clicked, so someone entering a
  stranger's address achieves nothing.
- **One-click unsubscribe** in every alert, plus `List-Unsubscribe` and
  `List-Unsubscribe-Post` headers. Mail providers weight these heavily; without
  them a list like this lands in Promotions or worse.
- **Physical postal address.** CAN-SPAM requires one in commercial email, and
  these sites carry affiliate links. Add yours to the footer in
  `alertEmail()` before sending at any volume — it is the one compliance gap
  left, and it needs an address only you can supply.
