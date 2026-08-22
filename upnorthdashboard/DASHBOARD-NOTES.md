# Up North Dashboard — build notes & data sources

**Domain:** upnorthdashboard.com
**Region:** Northern Lower Peninsula of Michigan
**Sibling site:** 906dashboard.com (Upper Peninsula) — same design system, same
architecture, shares the Cloudflare Worker proxy in `../tools/mdot-proxy/`.

## Why "Up North" and not "231"

231 is not the region. It covers northwestern Michigan and runs south toward
Muskegon, while the northeastern communities on this dashboard — Alpena,
Rogers City, Oscoda, Presque Isle — use 989. "Up North" is what people in and
out of the region actually call it, and it maps to the 26 counties this site
covers rather than to a telephone boundary.

## Files

| File | What it is |
|---|---|
| `index.html` | The entire dashboard — markup, styles and JS in one file, matching 906dashboard.com |
| `privacy.html` | Privacy policy and affiliate disclosure |
| `robots.txt`, `sitemap.xml` | Search basics |
| `.htaccess` | https + non-www canonicalization |

Deploy by uploading the contents of this folder to the upnorthdashboard.com
document root.

## Region definition

**Counties (26):** Emmet, Cheboygan, Presque Isle, Charlevoix, Antrim, Otsego,
Montmorency, Alpena, Leelanau, Benzie, Grand Traverse, Kalkaska, Crawford,
Oscoda, Alcona, Manistee, Wexford, Missaukee, Roscommon, Ogemaw, Iosco, Mason,
Lake, Osceola, Clare, Gladwin.

**NWS public zones:** MIZ016–MIZ018, MIZ020–MIZ041, plus MIZ098 (Beaver Island)
and MIZ099 (Charlevoix), which sit outside the numeric run. Verified against
`api.weather.gov/zones?area=MI`.

**Marine zones:** LMZ323, 341, 342, 344, 345, 346, 362, 364, 366 (northern Lake
Michigan and Grand Traverse Bay) and LHZ345, 347, 348, 349, 361, 362, 363
(Straits and northern Lake Huron).

## Live data sources

| Module | Source | Notes |
|---|---|---|
| City conditions | NWS station observations — KTVC, KPLN, KGLR, KAPN, KCAD, KCVX, KHTL, KMBL | Petoskey has no ASOS of its own; Pellston Regional (KPLN), 15 mi north, is the official station and is labelled as such |
| Mackinaw City | NOAA CO-OPS station 9075080 | Air temp, wind and water temp straight from the Straits, rather than borrowing Pellston |
| Alerts | `api.weather.gov/alerts/active?area=MI` + `?region=GL` | `region` must be upper-case — lower-case 400s |
| Roads | NWS observations bracketing each route | Ambient weather risk, explicitly labelled as not a pavement report |
| Incidents & construction | MDOT Mi Drive via `../tools/mdot-proxy/` with `?region=nlp` | **Needs the Worker redeployed** — see below |
| Mackinac Bridge | Bridge Authority WordPress REST endpoint (`?slug=conditions`) | Same parse the 906 site uses |
| Ferries | Date maths against each operator's published season | No live schedule API exists; the card always links out to the operator |
| Beaches | CO-OPS gauges 9075080 / 9075065 + NDBC buoys 45022, 45183, 45024, 45002 | The two CO-OPS beaches work without the proxy; the buoy beaches need it |
| Lake levels | NOAA CO-OPS water level, IGLD datum | Michigan and Huron are one lake hydrologically; listed separately because visitors think of them separately |
| Trails & forest roads | MI DNR ArcGIS temporary-closure layer | Bounding box overshoots into the UP and mid-Michigan, so results are re-filtered by county name |
| Snow | Open-Meteo snowfall totals + NWS station snow depth | Ski hills are curated links, not scrapes — see below |
| Fall color | **Model**, from a per-latitude progression curve shifted by Open-Meteo's 14-day overnight-low history | Labelled as an estimate everywhere it appears |
| Gas | EIA weekly Midwest average (PADD 2) | Same free key as the 906 site |
| Cameras | MDOT RWIS + traffic cams, Mackinac Bridge Authority | 51 cameras, IDs pulled from `mdotjboss.state.mi.us/MiDrive/camera/list` |

## Two things that need your action

1. **Redeploy the proxy Worker.** `worker.js` now accepts `?region=nlp` but the
   deployed copy predates it. Run this from `../tools/mdot-proxy/`:

   ```bash
   wrangler deploy
   ```

   Until then the Roads panel says "Proxy update needed" and the four
   buoy-backed beaches show no reading. Everything else is already live. The
   change is backwards-compatible — 906dashboard.com's calls are untouched.

2. **Point the domain at this folder** and confirm the `.htaccess` redirect
   rules match how your host is configured.

## Design decisions worth remembering

- **Fall color is modelled, not observed.** Michigan publishes no live foliage
  feed. The model uses a typical progression curve per latitude band, shifted
  earlier by up to a week when a band has racked up cold nights and later when
  it hasn't. It is labelled as a model in the panel, in the source note, and in
  the privacy page. Do not quietly upgrade the language to sound like a survey.
- **Ski areas are links, not scrapes.** Six northern Michigan resorts publish
  snow reports in six different layouts, and in August there is no live data to
  test a parser against. The live snow numbers on the page come from Open-Meteo
  and NWS station depth instead, which work year-round. If you want real resort
  numbers, add the scrapers mid-season when you can verify them against actual
  output — that is the honest time to build them.
- **The camera URLs come in two shapes.** MDOT's own listing gives
  `micamerasimages.net/thumbs/<name>.flv.jpg`, which 301-redirects to
  `micamerasimages.net/<name>.jpg`. The flat form is used directly to skip the
  redirect. RWIS cameras stay on `mdotjboss.state.mi.us`.
- **`#admin` reveals the edit buttons.** Visit `upnorthdashboard.com/#admin` to
  expose the "Today Up North" and weekend-highlight editors. Both write to
  browser localStorage only — they are your local overrides, not a CMS, and
  they will not appear for visitors.

## Refresh cadence

Data every 5 minutes, camera images every 60 seconds — same as the 906 site.
