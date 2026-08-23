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

Do one site first, confirm it, then the other. Lower TTL to 300s a day ahead if
IONOS allows it, so a rollback is fast.

In each Vercel project → **Settings → Domains**, add:

**`906dashboard`**
- `906dashboard.com` — primary
- `www.906dashboard.com` — set to **Redirect to `906dashboard.com`, 301**
- `blomblog.com` — set to **Redirect to `906dashboard.com`, 301**
- `www.blomblog.com` — set to **Redirect to `906dashboard.com`, 301**

**`upnorthdashboard`**
- `upnorthdashboard.com` — primary
- `www.upnorthdashboard.com` — set to **Redirect to `upnorthdashboard.com`, 301**

Then at **IONOS**, for each domain, change only:

| Record | Name | Value |
|---|---|---|
| `A` | `@` | `76.76.21.21` |
| `CNAME` | `www` | *copy the exact target Vercel shows in the Domains tab* |

Do not hardcode a `www` CNAME target from documentation. Vercel now issues
account- and region-specific targets (`cname.vercel-dns.com` and
`cname.vercel-dns-0.com` both appear in their docs). The value shown in your
own Domains tab is the authoritative one; a wrong target is an outage.

### Verify after cutover

```bash
for u in https://906dashboard.com/ https://906dashboard.com/fall.html \
         https://www.906dashboard.com/ http://blomblog.com/waterfalls.html \
         https://upnorthdashboard.com/ https://upnorthdashboard.com/fall.html; do
  echo "$(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' -L "$u")  $u"
done
```

Expected: `200` on the four real pages; `blomblog.com/waterfalls.html` and the
`www` hosts land on their apex equivalents with the path preserved.

Confirm the legacy pages still carry `noindex`:

```bash
curl -sI https://906dashboard.com/agatefalls.html | grep -i x-robots-tag
```

Confirm email still flows — send a test to an address on each domain.

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
