/**
 * Aurora widget API — one composed payload per widget render.
 *
 * Why this exists at all, given the dashboards already call SWPC and NWS
 * straight from the browser: a widget lives on *someone else's* site. Their
 * pageviews would multiply our upstream calls, arrive under their referrer,
 * and share no cache with anybody. Here every embed on the planet collapses
 * onto one edge-cached response per (region, spot) pair, so fifty clients cost
 * the same upstream traffic as one.
 *
 * Two things this can do that the browser version cannot:
 *
 *   1. Send a real User-Agent to api.weather.gov. NWS asks for an identifying
 *      UA and rate-limits by it; a browser cannot set that header at all.
 *   2. Resolve "tonight" in Eastern Time rather than the *visitor's* time.
 *      aurora.html uses browser-local hours, which is right for someone in
 *      Michigan and wrong for someone in Denver or Berlin planning a trip.
 *
 * Deliberately separate from up906-mdot-proxy and aurora-alerts, for the same
 * reason those two are separate from each other: a bad deploy here must not be
 * able to take down the dashboards' live data or the subscriber list.
 *
 * Endpoints:
 *   GET /aurora?region=up[&spot=mqt]   composed aurora payload
 *   GET /health                        liveness, no upstream calls
 */

const CACHE_TTL_SECONDS = 300; // SWPC republishes Kp about every 5 minutes

/**
 * Bump whenever the payload's SHAPE changes — a new field, a renamed one, a
 * different meaning for an existing one.
 *
 * The cache key is otherwise just (region, spot), which is right for the data
 * but wrong across a deploy: after shipping `whyNoSpot` the edge went on
 * serving payloads without it for the full TTL, so a freshly deployed Worker
 * and a freshly deployed widget still disagreed. Including the version here
 * makes a shape change invalidate its own cache the moment it deploys.
 *
 * Do NOT bump it for wording or threshold changes. Those want the old entries
 * to age out normally rather than a stampede of misses on every deploy.
 */
const PAYLOAD_SCHEMA = 2;

// Contact address in the UA is the part NWS actually cares about.
const USER_AGENT = '906dashboard.com-widget/1.0 (https://906dashboard.com; aurora@906dashboard.com)';

/**
 * Viewing locations. `spot` is the dark-sky site a visitor would actually
 * drive to; `name` is the town the cloud forecast is pulled for. They differ
 * on purpose — nobody stands in downtown Marquette to watch the aurora, but
 * the NWS gridpoint for Presque Isle and for Marquette are the same cell.
 *
 * Coordinates for the first five match the CITIES array in
 * sites/906/aurora.html so the widget and the page never disagree.
 */
const LOCATIONS = {
  mqt: { name: 'Marquette',        area: 'Marquette',        spot: 'Presque Isle Park',      lat: 46.5436, lon: -87.3954 },
  cph: { name: 'Copper Harbor',    area: 'the Keweenaw',     spot: 'Brockway Mountain',      lat: 47.4687, lon: -87.8879 },
  wfp: { name: 'Whitefish Point',  area: 'the eastern UP',   spot: 'Whitefish Point',        lat: 46.6291, lon: -85.0367 },
  mun: { name: 'Munising',         area: 'the central UP',   spot: 'Sand Point',             lat: 46.4111, lon: -86.6498 },
  irw: { name: 'Ironwood',         area: 'the western UP',   spot: "Little Girl's Point",    lat: 46.4547, lon: -90.1710 },
  grm: { name: 'Grand Marais',     area: 'the Grand Sable',  spot: 'Grand Marais Harbor',    lat: 46.6719, lon: -85.9814 },
  pcm: { name: 'Porcupine Mtns',   area: 'the Porkies',      spot: 'Union Bay',              lat: 46.8164, lon: -89.6284 },
};

// The regional roll-up. Matches aurora.html's five-city chip row exactly.
const REGIONS = {
  up: { label: 'the Upper Peninsula', spots: ['mqt', 'cph', 'wfp', 'mun', 'irw'] },
};

/**
 * Kp thresholds. The UP sits at roughly 55-57 degrees geomagnetic latitude,
 * so these are a full level lower than upnorthdashboard.com's. Ported
 * verbatim from sites/906/aurora.html:600 — if that scale ever changes, this
 * has to change with it or the widget and the page will contradict each other
 * on the same night.
 */
const VERDICTS = [
  { min: 7, level: 'excellent', pill: 'EXCELLENT', text: 'Yes — aurora likely overhead in the Upper Peninsula tonight.' },
  { min: 5, level: 'good',      pill: 'GOOD',      text: 'Yes — strong chance of visible northern lights tonight.' },
  { min: 4, level: 'fair',      pill: 'FAIR',      text: 'Maybe — aurora possible low on the northern horizon.' },
  { min: 3, level: 'long',      pill: 'LONG SHOT', text: 'Probably not — faint, camera-only at best.' },
];
const QUIET = { level: 'quiet', pill: 'QUIET', text: 'Not tonight — geomagnetic activity is too quiet.' };

// ── Eastern Time helpers ──────────────────────────────────────────────────
// A Worker runs in UTC wherever it happens to be scheduled, so every
// "tonight", "10 PM" and "dark hours" below has to be pinned to Michigan
// explicitly. Getting this wrong is invisible in testing from an ET laptop
// and wrong for four hours a day in production.

const ET = 'America/Detroit';

function etParts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const out = {};
  for (const part of fmt.formatToParts(date)) out[part.type] = part.value;
  // Intl renders midnight as hour 24 in some engines; normalise it.
  if (out.hour === '24') out.hour = '00';
  return out;
}

/** Offset, in ms, to add to a UTC instant to get ET wall-clock. Negative. */
function etOffsetMs(date) {
  const p = etParts(date);
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asIfUtc - date.getTime();
}

/**
 * Turn an ET wall-clock time into a real UTC instant. Two passes, because the
 * offset itself depends on the instant — one correction settles everything
 * except the hour that does not exist on the spring-forward morning, which is
 * 3 AM and therefore never a viewing window.
 */
function etWallToUtc(y, m, d, hour) {
  const naive = Date.UTC(y, m - 1, d, hour);
  let guess = naive - etOffsetMs(new Date(naive));
  guess = naive - etOffsetMs(new Date(guess));
  return new Date(guess);
}

/** Format a UTC instant as an ET hour label: "11 PM", "2 AM". */
function etHour(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: ET, hour: 'numeric', hour12: true })
    .format(date)
    .replace(/\s/g, ' ');
}

/**
 * Tonight's viewing windows, anchored to the current ET date.
 *
 * Before 6 AM ET we are still inside last night's session, so everything
 * shifts back a day — otherwise someone checking at 1 AM gets tomorrow's
 * forecast and a "best viewing 11 PM" that already happened.
 */
function tonightWindows(now) {
  const p = etParts(now);
  let y = +p.year, m = +p.month, d = +p.day;

  if (+p.hour < 6) {
    const yest = new Date(Date.UTC(y, m - 1, d) - 86400000);
    y = yest.getUTCFullYear(); m = yest.getUTCMonth() + 1; d = yest.getUTCDate();
  }

  const at = (hour, dayOffset = 0) => {
    const base = new Date(Date.UTC(y, m - 1, d) + dayOffset * 86400000);
    return etWallToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour);
  };

  return {
    // Whole session, for picking the peak Kp: 6 PM -> 6 AM.
    sessionStart: at(18),
    sessionEnd:   at(6, 1),
    // Real darkness, for picking the best-viewing window: 9 PM -> 5 AM.
    darkStart:    at(21),
    darkEnd:      at(5, 1),
    // Cloud forecast window: 10 PM -> 2 AM, matching aurora.html's nightWindow().
    cloudStart:   at(22),
    cloudEnd:     at(2, 1),
  };
}

// ── upstream fetches ──────────────────────────────────────────────────────

function getJson(url, ttl) {
  return fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    cf: { cacheTtl: ttl, cacheEverything: true },
  }).then((r) => {
    if (!r.ok) throw new Error(url + ' -> ' + r.status);
    return r.json();
  });
}

/** Latest observed planetary Kp. */
async function fetchCurrentKp() {
  const rows = await getJson('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', 180);
  // Row 0 is a header: ["time_tag","Kp","a_running","station_count"].
  const last = rows[rows.length - 1];
  const kp = parseFloat(Array.isArray(last) ? last[1] : last.Kp);
  const at = (Array.isArray(last) ? last[0] : last.time_tag);
  if (!isFinite(kp)) throw new Error('unparseable Kp');
  return { value: kp, at: at.replace(' ', 'T') + 'Z' };
}

/**
 * Tonight's forecast peak, the G-scale, and the best three-hour dark window.
 *
 * NOAA publishes Kp in three-hour blocks, so that block *is* the window. The
 * page comments make the same point: inventing a finer resolution would be a
 * lie about the data.
 */
async function fetchForecast(win) {
  const rows = await getJson('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', 600);
  const body = Array.isArray(rows[0]) && String(rows[0][0]).toLowerCase().includes('time')
    ? rows.slice(1)
    : rows;

  const gOrder = { G1: 1, G2: 2, G3: 3, G4: 4, G5: 5 };
  let peak = 0, gMax = null, darkPeak = -1, darkStart = null;

  for (const row of body) {
    const timeTag = Array.isArray(row) ? row[0] : row.time_tag;
    const kpRaw   = Array.isArray(row) ? row[1] : row.kp;
    const observed= Array.isArray(row) ? row[2] : row.observed;
    const scale   = Array.isArray(row) ? row[3] : row.noaa_scale;

    if (observed === 'observed') continue;

    const t  = new Date(String(timeTag).replace(' ', 'T') + 'Z');
    const kp = parseFloat(kpRaw);
    if (!isFinite(kp) || isNaN(t.getTime())) continue;

    if (t >= win.sessionStart && t <= win.sessionEnd) {
      if (kp > peak) peak = kp;
      if (t >= win.darkStart && t <= win.darkEnd && kp > darkPeak) {
        darkPeak = kp;
        darkStart = t;
      }
      if (scale && (!gMax || gOrder[scale] > gOrder[gMax])) gMax = scale;
    }
  }

  let window = null;
  if (darkStart) {
    const end = new Date(darkStart.getTime() + 3 * 3600 * 1000);
    window = etHour(darkStart) + ' – ' + etHour(end);
  }

  return { peak, scale: gMax, window };
}

/**
 * Mean NWS skyCover across the viewing window, weighted by how long each
 * value applies. Ported from aurora.html's meanSkyCover(); the gridpoint
 * series gives real percentages, where the text forecast only gives prose.
 */
function meanSkyCover(values, win) {
  let total = 0, ms = 0;
  for (const v of values || []) {
    if (v.value == null) continue;
    const [startStr, durStr] = String(v.validTime).split('/');
    const start = new Date(startStr);
    const end = new Date(start.getTime() + isoDurationMs(durStr));
    const lo = Math.max(start.getTime(), win.cloudStart.getTime());
    const hi = Math.min(end.getTime(), win.cloudEnd.getTime());
    if (hi > lo) { total += v.value * (hi - lo); ms += hi - lo; }
  }
  return ms ? Math.round(total / ms) : null;
}

function isoDurationMs(s) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(s || '');
  if (!m) return 3600000;
  return ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60) * 1000;
}

/**
 * Cloud cover for one location. Two hops: /points resolves the grid cell,
 * then the gridpoint carries the series. The /points mapping is effectively
 * permanent, so it gets a one-day edge TTL and costs nothing after the first
 * request of the day.
 */
async function fetchClouds(key, win) {
  const loc = LOCATIONS[key];
  const point = await getJson(`https://api.weather.gov/points/${loc.lat},${loc.lon}`, 86400);
  const grid  = await getJson(point.properties.forecastGridData, 900);
  const pct   = meanSkyCover(grid.properties.skyCover && grid.properties.skyCover.values, win);
  return { key, name: loc.name, area: loc.area, spot: loc.spot, pct };
}

// ── moon ──────────────────────────────────────────────────────────────────
// Same approximation the page uses. Good to a few hours, which is far finer
// than "is the sky going to be washed out tonight" needs.
function moonPhase(now) {
  const synodic = 29.530588853;
  const known = Date.UTC(2000, 0, 6, 18, 14);
  const days = (now.getTime() - known) / 86400000;
  const phase = ((days % synodic) + synodic) % synodic;
  const illum = Math.round(((1 - Math.cos((2 * Math.PI * phase) / synodic)) / 2) * 100);

  let name, icon;
  if (phase < 1.85)       { name = 'New Moon';        icon = '🌑'; }
  else if (phase < 7.38)  { name = 'Waxing Crescent'; icon = '🌒'; }
  else if (phase < 9.23)  { name = 'First Quarter';   icon = '🌓'; }
  else if (phase < 14.77) { name = 'Waxing Gibbous';  icon = '🌔'; }
  else if (phase < 16.61) { name = 'Full Moon';       icon = '🌕'; }
  else if (phase < 22.15) { name = 'Waning Gibbous';  icon = '🌖'; }
  else if (phase < 24.0)  { name = 'Last Quarter';    icon = '🌗'; }
  else if (phase < 27.68) { name = 'Waning Crescent'; icon = '🌘'; }
  else                    { name = 'New Moon';        icon = '🌑'; }

  const note = illum <= 35 ? 'great, dark skies'
             : illum >= 80 ? 'bright; find deeper darkness'
             : 'workable';
  return { name, icon, illum, note };
}

// ── verdict ───────────────────────────────────────────────────────────────

function verdictFor(kp) {
  for (const v of VERDICTS) if (kp >= v.min) return v;
  return QUIET;
}

/**
 * The plain-language bottom line. Kp sets the ceiling; cloud decides whether
 * that ceiling matters at all — which is the whole reason the widget shows
 * both numbers instead of just the headline Kp.
 *
 * When the widget is pinned to one town this speaks about that town's sky. On
 * the regional roll-up it names whichever spot is clearest, the way the page
 * does. Telling a guest in Marquette that Copper Harbor is clear is useless
 * to them, so a pinned widget never does it.
 *
 * `withSpot` false returns the same judgement without naming a viewing
 * location, for clients whose own page already recommends where to stand.
 * Both variants ship in every payload: composing them here keeps one copy of
 * the sentence logic, and costs nothing at the cache, where the key is still
 * just (region, spot).
 */
function whyLine(kp, best, windowText, pinned, withSpot) {
  if (kp < 3) return 'Skip it tonight. Geomagnetic activity is too low to be worth the drive.';

  const when = windowText ? ' after ' + windowText.split('–')[0].trim() : ' between 10 PM and 2 AM';

  if (!best || best.pct == null) {
    return kp >= 5
      ? 'Worth heading out' + when + ' — cloud forecast is unavailable, so check the sky before you drive.'
      : 'Marginal' + when + ', and the cloud forecast is unavailable right now.';
  }

  if (pinned) {
    const where = best.spot;
    if (best.pct <= 35) {
      if (kp >= 5) {
        return 'Worth the drive' + when + ' — skies over ' + best.name + ' should be mostly clear.'
          + (withSpot ? ' Head for ' + where + '.' : '');
      }
      return withSpot
        ? 'Worth a look' + when + ' from ' + where + ' — skies should be mostly clear.'
        : 'Worth a look' + when + ' — skies over ' + best.name + ' should be mostly clear.';
    }
    if (best.pct <= 69) {
      return withSpot
        ? 'Mixed skies over ' + best.name + when + '. Worth checking from ' + where + ', but expect gaps.'
        : 'Mixed skies over ' + best.name + when + ' — worth checking, but expect gaps.';
    }
    return 'Clouds over ' + best.name + ' are likely to block it tonight, whatever the Kp does.';
  }

  if (best.pct <= 35) {
    return kp >= 5
      ? 'Worth the drive' + when + ' — ' + best.name + ' has the clearest sky.'
      : 'Worth watching' + when + ' from a dark shoreline — ' + best.name + ' is your best bet.';
  }
  if (best.pct <= 69) {
    return 'Skies are mixed across the UP' + when + '. ' + best.name + ' looks the most promising.';
  }
  return 'Cloud cover is heavy across the UP tonight — even a strong Kp will struggle to get through.';
}

// ── payload ───────────────────────────────────────────────────────────────

async function buildAurora(region, spotKey) {
  const now = new Date();
  const win = tonightWindows(now);

  // A pinned widget reports one town's sky. The roll-up reports the region's
  // and names its clearest spot.
  const pinned = Boolean(spotKey);
  const keys = pinned ? [spotKey] : REGIONS[region].spots;

  const [kpNow, forecast, clouds] = await Promise.all([
    fetchCurrentKp().catch(() => null),
    fetchForecast(win).catch(() => null),
    Promise.all(keys.map((k) => fetchClouds(k, win).catch(() => {
      const loc = LOCATIONS[k];
      return { key: k, name: loc.name, area: loc.area, spot: loc.spot, pct: null };
    }))),
  ]);

  const peak = forecast ? forecast.peak : 0;
  const nowKp = kpNow ? kpNow.value : 0;
  const kp = Math.max(peak, nowKp);

  const usable = clouds.filter((c) => c.pct != null);
  usable.sort((a, b) => a.pct - b.pct);
  const best = usable.length ? usable[0] : (clouds[0] || null);

  const v = verdictFor(kp);
  const moon = moonPhase(now);

  return {
    ok: true,
    region,
    spot: spotKey || null,
    pinned,
    place: pinned ? LOCATIONS[spotKey].name : REGIONS[region].label,
    kp: {
      now: kpNow ? Number(nowKp.toFixed(2)) : null,
      nowAt: kpNow ? kpNow.at : null,
      peak: forecast ? Number(peak.toFixed(1)) : null,
      scale: forecast ? forecast.scale : null,
      window: forecast ? forecast.window : null,
    },
    clouds: clouds.map((c) => ({ key: c.key, name: c.name, spot: c.spot, pct: c.pct })),
    best: best ? { key: best.key, name: best.name, spot: best.spot, pct: best.pct } : null,
    moon,
    verdict: {
      level: v.level,
      pill: v.pill,
      text: v.text,
      why: whyLine(kp, best, forecast ? forecast.window : null, pinned, true),
      whyNoSpot: whyLine(kp, best, forecast ? forecast.window : null, pinned, false),
    },
    // Lets the widget say "showing last known conditions" instead of rendering
    // a box full of dashes, which is the failure mode that generates phone
    // calls when this is sitting on a client's homepage.
    sources: {
      kp: kpNow ? 'ok' : 'fail',
      forecast: forecast ? 'ok' : 'fail',
      clouds: usable.length === clouds.length ? 'ok' : usable.length ? 'partial' : 'fail',
    },
    generated: now.toISOString(),
  };
}

// ── http ──────────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // Without this a shared cache can hand one origin's Allow-Origin header to
    // a different origin, which fails CORS until the entry expires. This bit
    // us for real on up906-mdot-proxy — see that Worker's comment.
    'Vary': 'Origin',
  };
}

function json(body, origin, ttl) {
  return new Response(JSON.stringify(body), {
    status: body.ok === false ? (body.status || 400) : 200,
    headers: {
      ...corsHeaders(origin),
      'Cache-Control': ttl ? `public, max-age=${ttl}` : 'no-store',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== 'GET') {
      return json({ ok: false, status: 405, error: 'method not allowed' }, origin);
    }

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'aurora-widget-api', time: new Date().toISOString() }, origin);
    }

    if (url.pathname !== '/aurora') {
      return json({ ok: false, status: 404, error: 'not found' }, origin);
    }

    const region = (url.searchParams.get('region') || 'up').toLowerCase();
    const spotRaw = (url.searchParams.get('spot') || '').toLowerCase();
    const spot = spotRaw && spotRaw !== 'all' ? spotRaw : null;

    if (!REGIONS[region]) {
      return json({ ok: false, status: 400, error: 'unknown region: ' + region }, origin);
    }
    if (spot && !LOCATIONS[spot]) {
      return json({ ok: false, status: 400, error: 'unknown spot: ' + spot }, origin);
    }

    // The cache key is the DATA shape only — deliberately not the client, the
    // brand or the size. Those are presentation, applied in the browser. Bake
    // any of them in here and the cache fragments per customer, which is the
    // whole economic argument for the widget gone.
    const cacheKey = new Request(
      new URL(`/aurora?v=${PAYLOAD_SCHEMA}&region=${region}&spot=${spot || 'all'}`, url.origin).toString(),
      { method: 'GET' }
    );
    const cache = caches.default;

    const hit = await cache.match(cacheKey);
    if (hit) {
      const body = await hit.text();
      return new Response(body, {
        headers: { ...corsHeaders(origin), 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`, 'X-Cache': 'HIT' },
      });
    }

    try {
      const payload = await buildAurora(region, spot);
      const body = JSON.stringify(payload);

      const response = new Response(body, {
        headers: {
          ...corsHeaders(origin),
          'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
          'X-Cache': 'MISS',
        },
      });

      // Cache the body under the data-only key, with no CORS headers attached
      // to the stored copy, so the Vary above cannot leak one origin's header
      // to the next requester.
      ctx.waitUntil(cache.put(cacheKey, new Response(body, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` },
      })));

      return response;
    } catch (err) {
      return json({ ok: false, status: 502, error: 'upstream failure', detail: String(err && err.message || err) }, origin);
    }
  },
};
