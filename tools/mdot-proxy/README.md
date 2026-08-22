# UP 906 Proxy — Deploy Instructions

This is a tiny Cloudflare Worker that fetches two things server-side and
re-serves them with CORS headers so `index.html` on blomblog.com can read
them directly in the browser:

- `/events` — MDOT's real-time incident + construction data (filtered to the
  15 UP counties)
- `/buoys`  — live wave height / water temperature from one NDBC buoy per
  Great Lake (Superior, Michigan, Huron, Erie)

Both of MDOT's and NDBC's raw endpoints work fine and need no API key, but
neither sends an `Access-Control-Allow-Origin` header, so a browser on
blomblog.com can't call them directly — hence the proxy.

## One-time setup (you do this — needs your own Cloudflare login)

1. Sign up / log in at https://dash.cloudflare.com (free plan is fine).
2. Install the CLI: `npm install -g wrangler`
3. From this folder, run: `wrangler login`
   This opens a browser tab for you to authorize wrangler with your
   Cloudflare account. Claude cannot do this step for you — it requires
   your own account credentials.
4. Deploy: `wrangler deploy`
5. Wrangler will print a URL like:
   `https://up906-mdot-proxy.<your-subdomain>.workers.dev`
   Copy that URL.

## Wire it into the dashboard

Open `index.html`, find the line near the top of the `<script>` block:

```js
const MDOT_PROXY_URL = ''; // TODO: paste your Cloudflare Worker URL here after deploying
```

Paste your Worker URL in (no trailing slash), e.g.:

```js
const MDOT_PROXY_URL = 'https://up906-mdot-proxy.blomblog.workers.dev';
```

Save, and both the "Live Incidents & Construction" card and the wave
height / water temp lines on the Lakes cards will start pulling real data.

(Already done as of 2026-07-10 — this is set to
`https://up906-mdot-proxy.blomblog.workers.dev` in the live `index.html`.)

## Updating the Worker later

Edit `worker.js`, then run `wrangler deploy` again from this folder. This
has already happened twice: once for the initial MDOT proxy, once to add
the `/buoys` route and clean up some leftover HTML in MDOT's date fields.

## Serving two dashboards: the `region` parameter (added 2026-08-11)

`upnorthdashboard.com` (Northern Lower Peninsula) shares this same Worker.
Both routes now take an optional `?region=` parameter:

| Request | Returns |
|---|---|
| `/events` | UP incidents + construction (15 UP counties) — unchanged default |
| `/events?region=nlp` | Northern Lower Peninsula (26 counties, Emmet down to Gladwin) |
| `/buoys` | One buoy per Great Lake, keyed by lake name — unchanged default |
| `/buoys?region=nlp` | Six northern Lake Michigan / Lake Huron buoys, keyed by station id |

Anything other than `nlp` falls back to `up`, so every existing
906dashboard.com call keeps working byte-for-byte. Every response now also
echoes `"region"`, and upnorthdashboard.com checks that field: if it gets a
response without `region: "nlp"` it knows it is talking to a Worker built
before this change and says "Proxy update needed" in the Roads panel rather
than showing Upper Peninsula incidents on a Northern Michigan page.

**This change is written but not yet deployed.** Run `wrangler deploy` from
this folder to activate it. Until then, upnorthdashboard.com shows live
weather, roads-by-weather, bridge, ferries, beaches (from NOAA shore gauges),
lake levels, trails, snow and fall color, but the MDOT incident list and the
buoy wave heights stay dark.

Cloudflare's edge cache keys on the full URL including the query string, so
the two regions cache independently — no extra work needed there.

### NLP buoy stations (verified live 2026-08-11)

| Station | Location | Notes |
|---|---|---|
| 45022 | Little Traverse Bay, Petoskey | Bay water, warms earliest |
| 45183 | Sleeping Bear Dunes, Empire | Covers the National Lakeshore beaches |
| 45002 | North Michigan, mid-lake | Open-water reference near Beaver Island |
| 45024 | Ludington | South end of the region's Lake Michigan shoreline |
| 45175 | Mackinac Straits West | Shared with the UP set |
| 45212 | North Huron Spotter | Wave-only spotter; Alpena water temp comes from the CO-OPS gauge instead |

Note that 45162 (Thunder Bay, Alpena) is listed as active by NDBC but its
`realtime2` file was months stale when checked, so it is deliberately not
used — the Alpena water temperature comes from CO-OPS station 9075065.

## Buoy station choices

One representative, currently-active station per lake (verified live
2026-07-10):

| Lake | Station | Location | Notes |
|---|---|---|---|
| Superior | 45211 | Grand Island North | Actually on the UP shore, near Munising |
| Michigan | 45161 | Muskegon, MI | Nearest reliably-active buoy; several UP-side stations (Menominee, Port Inland) don't publish wave/temp data, only water level |
| Huron | 45175 | Mackinac Straits West | Right at the Mackinac Bridge — very relevant to the Bridge panel |
| Erie | 45005 | West Erie (Lorain, OH) | UP doesn't touch Lake Erie; kept for parity with the existing 4-lake layout |

If a station goes offline seasonally or permanently, `BUOY_STATIONS` at the
top of `worker.js` is the only place that needs updating — swap in a
different ID from https://www.ndbc.noaa.gov/mobile/region.php?reg=great_lakes
(confirm it has recent data at `ndbc.noaa.gov/data/realtime2/<id>.txt` first).

## Notes / things worth knowing

- The `incidents` endpoint's field names are confirmed live: `route`,
  `location`, `lanesEffected`, `type`, `county`, `message`, `reported`.
- The `construction` endpoint's fields are confirmed too (checked directly
  against the live Worker): `route`, `description`, `type`, `startDate`,
  `endDate`, `county`, `lat`, `lon`.
- Cost: $0. Cloudflare Workers free tier covers 100,000 requests/day —
  this dashboard uses a tiny fraction of that even with heavy traffic.
