/**
 * Shared CORS proxy (MDOT MiDrive + NDBC buoys)
 * Serves both 906dashboard.com (Upper Peninsula) and upnorthdashboard.com
 * (Northern Lower Peninsula) via a ?region= query parameter:
 *
 *   /events            → UP incidents & construction   (default, unchanged)
 *   /events?region=nlp → Northern Lower Peninsula
 *   /buoys             → one buoy per Great Lake       (default, unchanged)
 *   /buoys?region=nlp  → the northern Lake Michigan / Lake Huron buoy set,
 *                        keyed by station id
 *
 * Every response echoes `region` so a client can tell whether it is talking to
 * a Worker that understands the parameter.
 *
 * WHY THIS EXISTS:
 * MDOT's own public JSON endpoints for live incidents and construction
 * (mdotjboss.state.mi.us/MiDrive/incident/list/loadIncidents and
 * .../construction/list/loadConstruction) work fine and need no API key —
 * but MDOT's server doesn't send an Access-Control-Allow-Origin header,
 * so a browser on blomblog.com can't call them directly (confirmed by a
 * live cross-origin test — MDOT's own MiDrive page can call it because
 * that's same-origin; ours can't).
 *
 * NDBC's realtime2 buoy text files have the same problem in most browser
 * contexts, so this Worker also proxies live wave-height/water-temp data
 * for one representative buoy per Great Lake.
 *
 * This Worker fetches everything server-side (no CORS applies
 * server-to-server), and re-serves it with CORS headers so the dashboard's
 * client-side JS can read it directly.
 *
 * Deploy: see README.md in this same folder.
 * Endpoints once deployed:
 *   https://<your-subdomain>.workers.dev/events  (MDOT incidents/construction)
 *   https://<your-subdomain>.workers.dev/buoys   (NDBC wave height/water temp)
 */

const UP_COUNTIES = new Set([
  'Alger', 'Baraga', 'Chippewa', 'Delta', 'Dickinson', 'Gogebic', 'Houghton',
  'Iron', 'Keweenaw', 'Luce', 'Mackinac', 'Marquette', 'Menominee',
  'Ontonagon', 'Schoolcraft',
]);

// Northern Lower Peninsula — everything from the Straits down to the
// Clare/Gladwin line that people mean when they say "Up North".
const NLP_COUNTIES = new Set([
  'Emmet', 'Cheboygan', 'Presque Isle', 'Charlevoix', 'Antrim', 'Otsego',
  'Montmorency', 'Alpena', 'Leelanau', 'Benzie', 'Grand Traverse', 'Kalkaska',
  'Crawford', 'Oscoda', 'Alcona', 'Manistee', 'Wexford', 'Missaukee',
  'Roscommon', 'Ogemaw', 'Iosco', 'Mason', 'Lake', 'Osceola', 'Clare',
  'Gladwin',
]);

const COUNTY_SETS = { up: UP_COUNTIES, nlp: NLP_COUNTIES };

// Only these two values are accepted; anything else falls back to 'up' so the
// existing 906dashboard.com calls keep working unchanged.
function parseRegion(url) {
  const r = (url.searchParams.get('region') || 'up').toLowerCase();
  return COUNTY_SETS[r] ? r : 'up';
}

const INCIDENTS_URL    = 'https://mdotjboss.state.mi.us/MiDrive/incident/list/loadIncidents';
const CONSTRUCTION_URL = 'https://mdotjboss.state.mi.us/MiDrive/construction/list/loadConstruction';

// Cache MDOT responses at Cloudflare's edge for 4 minutes so we're not
// hammering their server every time a visitor's browser polls us
// (the dashboard itself polls every 5 min).
const CACHE_TTL_SECONDS = 240;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

// Pull lat/lon out of the "Go to" map link MDOT embeds in text fields,
// e.g. `<a href="/MiDrive/map?...&lat=45.10727&lon=-85.331&...">`
function extractLatLon(record) {
  for (const val of Object.values(record)) {
    if (typeof val === 'string') {
      const m = val.match(/lat=(-?\d+\.?\d*)&lon=(-?\d+\.?\d*)/);
      if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
    }
  }
  return { lat: null, lon: null };
}

// Strip embedded HTML out of text fields — MDOT's feed embeds a
// `<a href="...">Go to</a>` map link in location/description text, and a
// hidden `<span class="data-table-hidden-date">20260720</span>` sort key
// ahead of human-readable dates like startDate/endDate. Strip all tags so
// the client gets clean, readable text either way.
function stripMapLink(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<[^>]*>/g, '')
    // MDOT prefixes its date fields with a hidden YYYYMMDD sort key. Once the
    // surrounding <span> is stripped the two run together ("2026081308/13/2026"),
    // so drop the sort key when a human-readable date follows it.
    .replace(/\b\d{8}(?=\d{2}\/\d{2}\/\d{4})/g, '')
    // ...and the anchor text itself, now that the <a> around it is gone.
    .replace(/\s*Go to\s*$/, '')
    .trim();
}

function cleanRecord(record) {
  const cleaned = {};
  for (const [k, v] of Object.entries(record)) {
    cleaned[k] = stripMapLink(v);
  }
  return { ...cleaned, ...extractLatLon(record) };
}

async function fetchMdotJson(url) {
  const r = await fetch(url, {
    headers: {
      // MDOT's own site doesn't require a special UA, but identifying
      // ourselves is good practice for a public-sector API.
      'User-Agent': 'up906dashboard-proxy/1.0 (+https://blomblog.com)',
    },
  });
  if (!r.ok) throw new Error(`MDOT HTTP ${r.status} for ${url}`);
  return r.json();
}

async function buildPayload(region) {
  const counties = COUNTY_SETS[region];
  const [incidentsRaw, constructionRaw] = await Promise.all([
    fetchMdotJson(INCIDENTS_URL),
    fetchMdotJson(CONSTRUCTION_URL),
  ]);

  const incidents = (incidentsRaw || [])
    .filter(r => counties.has(r.county))
    .map(cleanRecord);

  const construction = (constructionRaw || [])
    .filter(r => counties.has(r.county))
    .map(cleanRecord);

  return {
    ok: true,
    region,
    incidents,
    construction,
    updated: new Date().toISOString(),
  };
}

// ── NDBC buoys ──
// One representative, currently-active station per Great Lake (verified live
// on 2026-07-10). 45211 and 45175 are genuinely on the UP shoreline
// (Munising and the Mackinac Straits); 45161 (Muskegon) and 45005 (West Erie)
// are the nearest reliably-active buoys for the other two lakes, matching
// this dashboard's existing pattern of one reference point per lake rather
// than exhaustive shoreline coverage.
const BUOY_STATIONS = {
  'Lake Superior': { id: '45211', name: 'Grand Island North (Munising, MI)' },
  'Lake Michigan':  { id: '45161', name: 'Muskegon, MI' },
  'Lake Huron':     { id: '45175', name: 'Mackinac Straits West (Mackinaw City, MI)' },
  'Lake Erie':      { id: '45005', name: 'West Erie (Lorain, OH)' },
};

// Northern Lower Peninsula buoys — the stations actually sitting off the
// beaches and bays this region cares about (verified live against NDBC on
// 2026-08-11). Keyed by station id because upnorthdashboard.com maps several
// buoys onto individual beaches rather than one buoy per lake.
const NLP_BUOY_STATIONS = {
  '45022': 'Little Traverse Bay (Petoskey, MI)',
  '45183': 'Sleeping Bear Dunes (Empire, MI)',
  '45002': 'North Michigan — mid-lake',
  '45024': 'Ludington, MI',
  '45175': 'Mackinac Straits West (Mackinaw City, MI)',
  '45212': 'North Huron Spotter (off Alpena)',
};

const BUOY_CACHE_TTL_SECONDS = 600; // NDBC stations update roughly every 10-60 min

// NDBC realtime2 files are whitespace-delimited text, 2 header rows (both
// starting with '#'), newest reading first. Columns:
// YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP DEWP VIS PTDY TIDE
// "MM" means missing/not reported.
function parseNdbcLatest(text) {
  const dataLines = text.trim().split('\n').filter(l => !l.startsWith('#'));
  if (!dataLines.length) return null;
  const c = dataLines[0].trim().split(/\s+/);
  const num = v => (v === undefined || v === 'MM') ? null : parseFloat(v);
  const [yy, mm, dd, hh, mi, , , , wvht, , , , , atmp, wtmp] = c;
  const waveM = num(wvht), waterC = num(wtmp), airC = num(atmp);
  return {
    time: `${yy}-${mm}-${dd}T${hh}:${mi}:00Z`,
    wave_height_m: waveM,
    wave_height_ft: waveM != null ? Math.round(waveM * 3.281 * 10) / 10 : null,
    water_temp_c: waterC,
    water_temp_f: waterC != null ? Math.round((waterC * 9 / 5 + 32) * 10) / 10 : null,
    air_temp_c: airC,
  };
}

async function fetchBuoy(stationId) {
  const r = await fetch(`https://www.ndbc.noaa.gov/data/realtime2/${stationId}.txt`, {
    headers: { 'User-Agent': 'up906dashboard-proxy/1.0 (+https://blomblog.com)' },
  });
  if (!r.ok) throw new Error(`NDBC HTTP ${r.status}`);
  const parsed = parseNdbcLatest(await r.text());
  if (!parsed) throw new Error('No data rows returned');
  return parsed;
}

async function readBuoy(id, name) {
  try {
    const data = await fetchBuoy(id);
    return { ok: true, station: id, stationName: name, ...data };
  } catch (e) {
    return { ok: false, station: id, stationName: name, error: e.message };
  }
}

async function buildBuoyPayload(region) {
  if (region === 'nlp') {
    const entries = await Promise.all(
      Object.entries(NLP_BUOY_STATIONS).map(async ([id, name]) => [id, await readBuoy(id, name)])
    );
    return { ok: true, region, buoys: Object.fromEntries(entries), updated: new Date().toISOString() };
  }
  const entries = await Promise.all(
    Object.entries(BUOY_STATIONS).map(async ([lake, s]) => [lake, await readBuoy(s.id, s.name)])
  );
  return { ok: true, region, lakes: Object.fromEntries(entries), updated: new Date().toISOString() };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (url.pathname !== '/events' && url.pathname !== '/buoys') {
      return new Response(JSON.stringify({ ok: false, error: 'Not found. Use /events or /buoys' }), {
        status: 404,
        headers: corsHeaders(origin),
      });
    }

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) {
      const body = await cached.text();
      return new Response(body, { headers: corsHeaders(origin) });
    }

    const region = parseRegion(url);

    try {
      const payload = url.pathname === '/buoys'
        ? await buildBuoyPayload(region)
        : await buildPayload(region);
      const ttl = url.pathname === '/buoys' ? BUOY_CACHE_TTL_SECONDS : CACHE_TTL_SECONDS;
      const body = JSON.stringify(payload);
      const response = new Response(body, {
        headers: { ...corsHeaders(origin), 'Cache-Control': `public, max-age=${ttl}` },
      });
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 200, // keep 200 so the dashboard's client JS can read the error cleanly
        headers: corsHeaders(origin),
      });
    }
  },
};
