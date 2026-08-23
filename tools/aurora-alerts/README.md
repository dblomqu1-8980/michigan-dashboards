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

Add **`alerts.906dashboard.com`** and **`alerts.upnorthdashboard.com`** —
subdomains, deliberately.

Verifying the root domains would put Resend's SPF alongside the existing
`v=spf1 include:_spf-us.ionos.com ~all` and its DKIM alongside IONOS's
`s1`/`s2` keys. Getting that merge wrong breaks mail delivery for the whole
domain. A subdomain is a separate namespace: its records cannot affect the root
domain's IONOS mail, and reputation damage from a bad alert send stays
contained.

Resend will show the exact records — add them at IONOS under the subdomain.
Leave every existing root-level `MX`, `TXT`, `_dmarc` and `_domainkey` record
alone.

Change the `SENDER_UP` / `SENDER_NLP` vars in `wrangler.toml` if you use
different addresses.

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

## Database

D1, `aurora-alerts` (`2298fb19-130d-49cf-aaa3-f0e338ef657d`).

```bash
npx wrangler d1 execute aurora-alerts --remote \
  --command="SELECT region, status, COUNT(*) FROM subscribers GROUP BY region, status;"

npx wrangler d1 execute aurora-alerts --remote \
  --command="SELECT * FROM alert_log ORDER BY sent_at DESC LIMIT 10;"
```

Schema is in `schema.sql`; re-running it is safe (`IF NOT EXISTS` throughout).

### Importing the old FormSubmit list

`aurora-subscribers.csv` at the repo root holds the three addresses collected
through FormSubmit. They opted in to UP aurora alerts specifically, so
importing them as `active` for region `up` is defensible — but it is your list
and your call:

```bash
npx wrangler d1 execute aurora-alerts --remote --command \
  "INSERT OR IGNORE INTO subscribers (email, region, status, token, created_at, confirmed_at)
   VALUES ('someone@example.com','up','active',lower(hex(randomblob(24))),datetime('now'),datetime('now'));"
```

The safer alternative is to email them once asking them to re-subscribe
through the new form, which gets you a clean double-opt-in record.

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
