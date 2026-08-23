# Deployment

Two sites, one repository.

| Site root | Domain | Vercel project |
|---|---|---|
| `sites/906/` | 906dashboard.com | `906dashboard` |
| `sites/upnorth/` | upnorthdashboard.com | `upnorthdashboard` |

Everything outside `sites/` — `CLAUDE.md`, `SKILL.md`, `reference.md`,
`workflows`, `tools/`, `backup/`, `archive/` — is **never deployed**. That is
the point of the layout: internal files can't leak because they aren't inside a
site root, not because a blocklist remembers to exclude them.

---

## ⚠️ Read this before touching DNS

**All three domains carry live IONOS email.** As of 2026-08-22:

```
906dashboard.com       MX -> mx00/mx01.ionos.com   SPF -> _spf-us.ionos.com
upnorthdashboard.com   MX -> mx00/mx01.ionos.com   SPF -> _spf-us.ionos.com
blomblog.com           MX -> mx00/mx01.ionos.com   SPF -> _spf-us.ionos.com
```

All three also hold **Google Search Console verification TXT records**.

**Do not move nameservers to Vercel.** Vercel's DNS would not carry these
records and email would stop delivering, silently, along with losing Search
Console verification.

Change **only** the `A` record (and add the `www` CNAME) at IONOS. Leave `NS`,
`MX`, `TXT` and `SPF` exactly as they are.

---

## Status

- [x] Repo restructured into site roots
- [x] `vercel.json` written for both sites
- [x] Verified both sites serve correctly from their new roots
- [x] Vercel projects created, Git-linked, deploying from `main`
- [x] Deployments verified over HTTP (see below)
- [ ] DNS cutover — **the only step left**

Live now:

| Project | Root Directory | URL |
|---|---|---|
| `906dashboard` | `sites/906` | https://906dashboard.vercel.app |
| `upnorthdashboard` | `sites/upnorth` | https://upnorthdashboard.vercel.app |

Every push to `main` redeploys both automatically.

---

## Verified on the deployments

Checked over HTTP against both `*.vercel.app` URLs:

- every page and asset serves `200`, including all waterfall photos
- `CLAUDE.md`, `SKILL.md`, `reference.md`, `DEPLOYMENT.md`, `workflows`,
  `archive/`, `tools/` and `vercel.json` all `404` — the site roots hold
- `.html` URLs serve directly with no redirect, confirming `cleanUrls` is off
- all three legacy Agate Falls pages carry `X-Robots-Tag: noindex, nofollow`
- security headers present on every response
- both fall pages render fully and the live colour model returns real
  Open-Meteo data with no console errors

Two defects were found this way and fixed in `68885e5`:

1. **`.htaccess` was publicly readable** on both sites. Vercel serves it as an
   ordinary static file, publishing the internal rewrite rules. Now excluded
   via `.vercelignore` in each site root.
2. **`agate falls.shtml` had no `noindex`.** A literal space in a `vercel.json`
   header `source` does not match the encoded request path. Replaced with
   `/(.*\.shtml)`.

The host-conditional redirects in `vercel.json` (blomblog → 906, www → apex)
**cannot be tested until DNS points at Vercel**, since those hosts have to
reach the project for the rule to fire. Verify them right after cutover using
the commands below.

## DNS cutover

Full record-level audit taken 2026-08-22. All three domains sit on IONOS
nameservers (`ui-dns.*`) and share one host, `74.208.236.156`.

### Two traps in the current records

**1. Every domain has an AAAA (IPv6) record — on both apex and www.**

```
@    AAAA  2607:f1c0:100f:f000::28b
www  AAAA  2607:f1c0:100f:f000::28b
```

Change only the A record and IPv6-capable visitors keep resolving to IONOS.
The result is a split brain: some people see Vercel, some see the old host,
and it looks intermittent rather than broken. **The AAAA records must be
deleted.** Vercel's apex is served by an A record only.

**2. `www` is currently an A record, not a CNAME.**

So `www` is a delete-then-create, not an edit: remove the `A` and `AAAA`,
then add a `CNAME`.

### Records that must survive untouched

These carry live email and verification. Do not edit or delete any of them:

| Record | Value | Purpose |
|---|---|---|
| `MX @` | `mx00.ionos.com`, `mx01.ionos.com` (both pri 10) | email delivery |
| `TXT @` | `v=spf1 include:_spf-us.ionos.com ~all` | SPF |
| `CNAME _dmarc` | `dmarc.ionos.com` | DMARC (`p=none`) |
| `CNAME autodiscover` | `adsredir.ionos.info` | Outlook autoconfig |
| `TXT @` | `google-site-verification=...` | Search Console |
| `NS` | `ns*.ui-dns.*` | **do not move nameservers** |

`blomblog.com` additionally has `mail` → `ghs.google.com` and `ftp` →
`216.250.120.227`. Leave both alone.

There are no CAA records on any of the three, so nothing blocks Vercel from
issuing certificates.

### Step 0 — the day before: lower TTL

Every record is currently at **TTL 3600** (1 hour), which means a mistake takes
an hour to undo. In IONOS, edit the apex `A` and `www` records and set TTL to
**300**. Wait an hour for the old TTL to expire, then do the cutover. Restore
TTL to 3600 a few days after everything is confirmed.

### Step 1 — add the domains in Vercel first

Do this **before** touching IONOS, so Vercel is ready to issue the certificate
the moment DNS resolves.

**Project `906dashboard`** → Settings → Domains → Add:
- `906dashboard.com` — leave as primary
- `www.906dashboard.com` — choose **Redirect to `906dashboard.com`**, 301
- `blomblog.com` — choose **Redirect to `906dashboard.com`**, 301
- `www.blomblog.com` — choose **Redirect to `906dashboard.com`**, 301

**Project `upnorthdashboard`** → Settings → Domains → Add:
- `upnorthdashboard.com` — primary
- `www.upnorthdashboard.com` — **Redirect to `upnorthdashboard.com`**, 301

Vercel will show each domain as misconfigured and display the exact records it
wants. **Copy the `www` CNAME target from that screen.** Vercel issues
account- and region-specific targets, and their own docs show two different
values (`cname.vercel-dns.com` and `cname.vercel-dns-0.com`). The Domains tab
is authoritative; a guessed target is an outage.

### Step 2 — change the records at IONOS

Menu → **Domains & SSL** → click the domain → **DNS** tab.

Do one domain at a time, in this order: `upnorthdashboard.com` first (smallest
site, proves the process), then `906dashboard.com`, then `blomblog.com`.

For each domain:

| Action | Type | Name | Value |
|---|---|---|---|
| **DELETE** | `AAAA` | `@` | `2607:f1c0:100f:f000::28b` |
| **DELETE** | `AAAA` | `www` | `2607:f1c0:100f:f000::28b` |
| **DELETE** | `A` | `www` | `74.208.236.156` |
| **EDIT** | `A` | `@` | `74.208.236.156` → **`76.76.21.21`** |
| **ADD** | `CNAME` | `www` | *the target Vercel shows* |

Use `76.76.21.21` only if that is what Vercel's Domains tab shows for the apex;
it is the long-standing value, but trust the panel over this file.

**Likely snag:** if the domain is bound to an IONOS hosting package or website,
IONOS greys out the `A` record and shows something like "managed by your
hosting". You have to disconnect the site from the hosting package first —
Domains & SSL → the domain → **Destination** → change to **External / point to
an IP address**. Only then does the A record become editable.

### Verify after cutover

```bash
# 1. IPv4 and IPv6 must BOTH point at Vercel (or IPv6 must not resolve at all)
for d in 906dashboard.com upnorthdashboard.com blomblog.com; do
  echo "$d  A=$(dig +short A $d | tr '\n' ' ') AAAA=$(dig +short AAAA $d | tr '\n' ' ')"
done

# 2. Pages and redirects
for u in https://906dashboard.com/ https://906dashboard.com/fall.html \
         https://www.906dashboard.com/ http://blomblog.com/waterfalls.html \
         https://upnorthdashboard.com/ https://upnorthdashboard.com/fall.html; do
  echo "$(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' -L "$u")  $u"
done

# 3. Email records must be unchanged
for d in 906dashboard.com upnorthdashboard.com blomblog.com; do
  echo "$d MX=$(dig +short MX $d | tr '\n' ' ') SPF=$(dig +short TXT $d | grep spf1)"
done
```

The AAAA check in step 1 is the one people skip. If it still returns
`2607:f1c0:...` you are half-migrated and some visitors are on the old host.

Expected: `200` on the four real pages; `blomblog.com/waterfalls.html` and the
`www` hosts land on their apex equivalents with the path preserved.

Confirm the legacy pages still carry `noindex`:

```bash
curl -sI https://906dashboard.com/agatefalls.html | grep -i x-robots-tag
```

Confirm email still flows — send a test to an address on each domain, and
reply to it, so both inbound and outbound are proven.

### Rollback

If anything is wrong, put the records back:

| Type | Name | Value |
|---|---|---|
| `A` | `@` | `74.208.236.156` |
| `AAAA` | `@` | `2607:f1c0:100f:f000::28b` |
| `A` | `www` | `74.208.236.156` |
| `AAAA` | `www` | `2607:f1c0:100f:f000::28b` |

…and delete the `www` CNAME. With TTL at 300 this takes effect in ~5 minutes.
The IONOS host is untouched throughout the migration, so it is still serving
and rollback is just a DNS change. Do not delete anything on IONOS until the
Vercel deployments have been live and correct for at least a week.

---

## Why `cleanUrls` is off

`sites/*/vercel.json` sets `"cleanUrls": false` deliberately. Turning it on
makes Vercel 301 `/waterfalls.html` → `/waterfalls`. Every canonical tag,
sitemap entry, RSS link and inbound link on both sites uses the `.html` form,
so enabling it would invalidate the entire indexed URL set for a cosmetic gain.
Leave it off.

---

## The current Apache host

`sites/906/.htaccess` and `sites/upnorth/.htaccess` are kept so the sites can
still be deployed to IONOS during the transition. They are inert on Vercel.

`sites/906/.htaccess` now returns 404 for `*.md`, `workflows`, `.env` and
`tools/`|`backup/`. This closes a live exposure — `CLAUDE.md`, `SKILL.md`,
`reference.md` and the `workflows` archive were all returning 200 in production.
**Upload that file to IONOS to close it now**, independent of the Vercel work.

Once DNS is fully cut over and verified, both `.htaccess` files can be deleted.

---

## Known follow-up

`EIA_API_KEY` is hardcoded in both `index.html` files. It must ship in
client-side JS for the gas-price panel, so it is already public in page source —
committing it exposes nothing new, but **keep this repository private**. The
real fix is to proxy the EIA call through the existing Cloudflare Worker in
`tools/mdot-proxy/`, the way MDOT already is, which removes it from the browser.
