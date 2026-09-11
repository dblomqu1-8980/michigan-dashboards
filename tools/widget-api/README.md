# Aurora widget

An embeddable aurora forecast for client websites. Two pieces:

| Piece | Lives in | Deploys to |
|---|---|---|
| Data API | `tools/widget-api/` | Cloudflare Worker `aurora-widget-api` |
| Widget + loader | `sites/widgets/` | Vercel project `906widgets`, `widgets.906dashboard.com` |

This file is the ops doc and deliberately sits **outside** `sites/`, for the
same reason `DEPLOYMENT.md` gives: internal files can't leak because they
aren't inside a site root, not because a blocklist remembered them.

---

## Why a third site root

`sites/widgets/` is its own Vercel project, not a folder on `906dashboard`.

The dashboard sets `X-Frame-Options: SAMEORIGIN` on `/(.*)`, which is correct
clickjacking protection and must stay. Embedding needs that header *absent* and
`Content-Security-Policy: frame-ancestors` in its place. Carving an exception
out of the dashboard's rule would mean a negative-lookahead source like
`/((?!embed/).*)` — and a typo there silently strips clickjacking protection
from the whole dashboard with nothing visibly broken. A separate project makes
that failure impossible, and lets the widget be redeployed and cached on its
own schedule.

It also keeps the DNS change to a single `CNAME` on the `widgets` subdomain.
The apex `A`, `MX`, `SPF` and Search Console records that `DEPLOYMENT.md` warns
about are never touched.

---

## Adding a client

Four steps, about ten minutes.

**1. Add them to `sites/widgets/clients.json`.**

```json
"northwoods-inn": {
  "name": "Northwoods Inn",
  "region": "up",
  "spot": "mqt",
  "spotLabel": "M-28 Waysides",
  "size": "card",
  "attribution": true,
  "brand": { "bg": "#12100E", "card": "#1E1A16", "ink": "#F5EFE6",
             "muted": "#A99781", "line": "#332C24",
             "a1": "#E0A43C", "a2": "#8C5A2B" }
}
```

**2. Add their hostnames to `frame-ancestors` in `sites/widgets/vercel.json`.**

This is the step that actually grants access, and the one that is easy to
forget — everything else will look fine and the widget will render a blank
frame on their site. Include the `www` form if they use it.

**3. Push to `main`.** Vercel redeploys `widgets` automatically.

**4. Send them `https://widgets.906dashboard.com/`** — the install page, with
their snippet, the platform notes and a live preview.

### Checking their brand before you commit it

The five verdict colours are **not** brandable — they carry the Kp forecast,
not the styling — so a client's palette has to stay legible behind them. The
widget picks the verdict pill's ink by luminance at runtime, which handles most
cases, but a very low-contrast ground will still read badly. Check a candidate
palette against the scale before shipping it.

### Name the spot their own site recommends

`spotLabel` overrides the viewing spot the widget names, for clients whose own
copy points somewhere else. This is not cosmetic. Travel Marquette's
northern-lights page calls the M-28 Waysides in Chocolay Township "easy access
points in the dark" — the right call for a visitor driving at night. It also
names Sugarloaf Mountain and Wetmore Landing, and never mentions Presque Isle
Park, which is what `sites/906/aurora.html` picks for Marquette. Without the override the widget
would sit on their page recommending a location the paragraph above it does
not, which reads as a bolted-on third-party box rather than part of their site.

It is applied in the browser, so it never reaches the cached payload, and it
rewrites the Worker's composed verdict line too — both strings are known
exactly at that point, so the substitution is defined rather than a guess at
the sentence shape.

Check a new client's own pages before setting this. If their copy names no spot
at all, leave it unset and the default stands.

### The client id is not a secret

It is in the page source on their site and in a public JSON file. Access
control is `frame-ancestors` plus the hostname, nothing else. An id copied to
an unlisted domain renders a blank frame, which is the intended behaviour.

---

## The data API

```
GET https://aurora-widget-api.blomblog.workers.dev/aurora?region=up&spot=mqt
GET .../aurora?region=up            # regional roll-up, all five towns
GET .../health
```

`spot` is one of `mqt cph wfp mun irw grm pcm`, or `all`. Unknown values are
rejected with a 400 rather than silently falling back, so a typo in a client
config surfaces immediately instead of quietly serving the wrong town.

### Pinned vs roll-up

A pinned widget reports **that town's own sky** and names its viewing spot.
The roll-up reports the region and names whichever of the five towns is
clearest. This is not cosmetic: telling a guest already in Marquette that
Copper Harbor is clearer is useless to them, so a pinned widget never does it.

### What it does that the browser cannot

- **Sends a real User-Agent to `api.weather.gov`.** NWS asks for an identifying
  UA and rate-limits by it; a browser cannot set that header.
- **Resolves "tonight" in Eastern Time.** `sites/906/aurora.html` uses the
  *visitor's* local hours, which is right in Michigan and wrong for someone
  planning a trip from Denver. Every window here is pinned to
  `America/Detroit`.
- **Collapses the fan-out.** One edge-cached response per `(region, spot)`
  serves every embed everywhere for 5 minutes.

### The cache key is data-only, on purpose

`region` and `spot` only — never client, brand or size. Those are presentation
and are applied in the browser. Bake any of them into the cache key and it
fragments per customer, which removes the entire economic argument for the
widget: fifty clients would then cost fifty times the upstream calls instead of
the same as one.

### Keeping the scale in sync

`VERDICTS` in `worker.js` is ported verbatim from `sites/906/aurora.html:600`.
If that scale ever changes, change it here too, or the widget and the page will
give different answers on the same night. Up North's thresholds run a full Kp
level higher (geomagnetic latitude ~53–55° against the UP's ~55–57°), which is
why `REGIONS` has no `nlp` entry yet — adding one means adding its own verdict
table, not reusing this one.

---

## Deploying

```bash
cd tools/widget-api
npx wrangler deploy
```

Verify:

```bash
for p in "/health" "/aurora?region=up" "/aurora?region=up&spot=mqt"; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' "https://aurora-widget-api.blomblog.workers.dev$p")  $p"
done
```

The site half deploys with any push to `main` once the Vercel project exists.

### Setup status

Done:

1. Worker deployed — `https://aurora-widget-api.blomblog.workers.dev`, verified
   in production (`/health`, both widget modes, CORS reflection from
   travelmarquette.com, cache HIT, 400 and 404 paths).
2. Vercel project `906widgets` created: root directory `sites/widgets`, linked
   to `dblomqu1-8980/michigan-dashboards`, production branch `main`.
3. `sites/widgets/aurora.html` already points at the deployed Worker hostname.

Outstanding:

4. **Merge the PR.** The project's production branch is `main`; until the
   widget files land there, production has nothing to build.
5. **Add the `CNAME` at IONOS.** `widgets.906dashboard.com` is already added to
   the Vercel project; it reads `misconfigured` only because the DNS record does
   not exist yet. Vercel's own config endpoint currently gives:

   | Type | Name | Value |
   |---|---|---|
   | `CNAME` | `widgets` | `ed3a4883bedc007a.vercel-dns-016.com.` |

   That target is account- and region-specific — `DEPLOYMENT.md` is explicit
   that a guessed one is an outage, so re-read it from the Domains tab at the
   moment you create the record rather than trusting this table if time has
   passed. Change nothing else in that zone: the apex `A`, `MX`, `SPF`, DKIM,
   DMARC and Search Console records stay exactly as they are. This is the
   safest possible change to these domains — one new subdomain record, nothing
   edited, nothing deleted.
6. **Decide the deployment-protection posture** — see below.

### Deployment protection

The project was created with Vercel's team default,
`ssoProtection: all_except_custom_domains`. Both sibling projects
(`906dashboard`, `upnorthdashboard`) have protection off entirely.

Left as-is this is workable and arguably the safer posture: the custom domain
is exempt, so `widgets.906dashboard.com` serves publicly and the widget works.
Only preview deployments sit behind SSO — which means an unreleased widget
cannot be embedded by accident, but also that `frame-ancestors` cannot be
verified on a preview URL. The protection page answers every request with a
302 and `x-frame-options: DENY`, so a framed preview shows nothing.

Turn it off only if preview testing is worth more than that: Project Settings
-> Deployment Protection -> Vercel Authentication -> Disabled.

---

## Local development

```bash
cd tools/widget-api && npx wrangler dev --port 8799 --local
```

Then start the `widgets` server from `.claude/launch.json` (port 8903). The
widget resolves its API base from `location.hostname`, so a page served from
localhost automatically talks to the local Worker. That is deliberately *not* a
query parameter — letting a URL choose the API origin would let anyone point an
embed at a server they control and render whatever they liked inside our frame.

### Testing states the live sky will not give you

Most nights are quiet, so the interesting verdicts never appear on their own.
Seed the last-known-good cache and stop the Worker; the widget will render what
you put there:

```js
localStorage.setItem('906w:aurora:lastgood:up:mqt', JSON.stringify(payload));
```

Verified this way during the build: `QUIET`, `GOOD` and `EXCELLENT`; card,
strip and panel; dark, light and default palettes; pinned and roll-up; live,
last-known-good and fully offline; mobile reflow; and the loader's height
handshake.

---

## Failure behaviour

This sits on a client's homepage, so a dead feed is a phone call rather than a
dash in a cell. Three tiers, in order:

1. **Live data.**
2. **Last known good** from that visitor's `localStorage`, stamped
   `Last known · 1:17 PM` in the caution colour.
3. **Offline** — a complete, correctly-branded component reading "Aurora
   conditions are unavailable right now", never a broken box or an empty frame.

It recovers on its own; there is nothing to restart.

---

## Deliberately not included

- **No email signup.** The aurora page's signup writes to `aurora-alerts`' D1
  subscriber table, and `POSTAL_ADDRESS` there is still unset — deferred on the
  grounds that the only subscribers are the owner's own addresses. Collecting
  addresses through a client's live site ends that justification. Set the
  postal address before revisiting this.
- **No GA4 site tag.** The dashboard's property must not count client traffic.
  Attribution is measured instead through the UTM on the outbound link
  (`utm_source=widget&utm_medium=embed&utm_campaign=<client>`).
- **No affiliate scripts.** `sites/906/index.html` carries an AvantLink tag; the
  widget must never inherit it.
- **No webfont.** One less third-party request on someone else's page.

## Licensing

NOAA SWPC and `api.weather.gov` are US federal data and fine to redistribute
with a proper User-Agent and a cache in front. This is the one widget on the
menu with no licensing question — the Open-Meteo non-commercial limit that
affects any future fall-colour or ski widget does not apply here.
