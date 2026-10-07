/**
 * NWS Climate Report (CLI) parser — observed snow, for the ski widget.
 *
 * Why this exists: `sites/906/ski.html` gets snow depth from Open-Meteo, whose
 * free tier is non-commercial — the same licensing question `sun.js` solves for
 * hunting. Unlike sunrise, snow depth is not computable, so it has to come from
 * somewhere real.
 *
 * It is not in the obvious places. Verified 2026-10-07 against live NWS:
 *
 *   - The `gridpoints` endpoint carries `snowfallAmount`, `snowLevel` and
 *     `iceAccumulation` but has NO snow-depth field at all. Those are
 *     forecasts; depth is an observation.
 *   - A station's `observations/latest` has no `snowDepth` key either — not
 *     merely null in October, absent entirely, and absent at Barrow and
 *     Fairbanks too. (`sites/906/trails.html` reads `p.snowDepth?.value`, which
 *     is therefore always undefined. It fails safe, but it is dead.)
 *
 * The CLI product is where NWS actually publishes it. It is plain text meant
 * for humans, so this parser is deliberately strict: it reads only the
 * SNOWFALL block, only from labels it knows, and returns null rather than
 * guessing whenever the shape is not what it expects. A wrong base depth sends
 * someone on a four-hour drive to bare ground.
 *
 * Coverage is the real cost of this choice, and it is regional, not per-hill:
 * Michigan has exactly three CLI sites — Marquette (MQT), Gaylord (APX) and
 * Grand Rapids (GRR). The widget labels the number with the station it came
 * from for that reason; see ski-data.js.
 *
 * The report describes YESTERDAY. `date` is the climate date in the product's
 * own words, not the issuance date, and the widget shows it — a depth reading
 * is a fact about a morning, and pretending otherwise is how a stale number
 * becomes an authoritative one.
 */

const MONTHS = {
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6,
  JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
};

// Labels that can appear in the SNOWFALL block, longest first so that
// "SINCE JUL 1" is never matched as a prefix of something else.
const SNOW_ROWS = [
  ['SNOW DEPTH', 'depth'],
  ['MONTH TO DATE', 'monthToDate'],
  ['SINCE JUL 1', 'sinceJul1'],
  ['SINCE SEP 1', 'sinceSep1'],
  ['SINCE DEC 1', 'sinceDec1'],
  ['YESTERDAY', 'yesterday'],
  ['TODAY', 'today'],
];

/**
 * One cell of the OBSERVED column.
 *
 * `T` is a trace — real snow fell, less than 0.05". It is not zero and it is
 * not missing, and the distinction matters on the first fall of the season,
 * so it comes back as 0 with `trace` set rather than being flattened.
 *
 * `MM` is the NWS missing marker. Gaylord's October product uses it for
 * normals, so it is not hypothetical.
 */
function cell(raw) {
  if (raw == null) return { value: null, trace: false, missing: true };
  const t = String(raw).trim().toUpperCase();
  if (t === 'M' || t === 'MM' || t === '') return { value: null, trace: false, missing: true };
  if (t === 'T') return { value: 0, trace: true, missing: false };
  const n = Number(t);
  return Number.isFinite(n)
    ? { value: n, trace: false, missing: false }
    : { value: null, trace: false, missing: true };
}

/** The climate date the report describes — "...FOR OCTOBER 6 2026..." */
function parseDate(text) {
  const m = text.match(/CLIMATE SUMMARY FOR\s+([A-Z]+)\s+(\d{1,2})\s+(\d{4})/i);
  if (!m) return null;
  const mon = MONTHS[m[1].toUpperCase()];
  if (!mon) return null;
  const d = String(Number(m[2])).padStart(2, '0');
  return `${m[3]}-${String(mon).padStart(2, '0')}-${d}`;
}

/**
 * Slice out the SNOWFALL block.
 *
 * It ends at the next section header, which is a line starting in column 0
 * that is not one of our indented data rows. Reading to the next blank line
 * would be wrong: Marquette's block has no blank line before SNOW DEPTH, but
 * other offices pad differently and the block would be truncated mid-table.
 */
function snowBlock(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^SNOWFALL\s*\(IN\)/i.test(l.trim()) && /^\S/.test(l));
  if (start < 0) return null;

  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\S/.test(l) && l.trim()) break;   // next section header
    if (/^\s*\.{5,}/.test(l)) break;         // the dotted rule between sections
    out.push(l);
  }
  return out;
}

/**
 * Parse a CLI product into observed snow numbers.
 *
 * Returns null when the product has no SNOWFALL block at all, which is a real
 * case rather than an error: offices drop the section outside snow season.
 * Individual rows come back null when absent — Gaylord in October publishes
 * YESTERDAY and nothing else, so a caller must treat every field as optional.
 */
export function parseCli(text) {
  if (!text || typeof text !== 'string') return null;

  const date = parseDate(text);
  const block = snowBlock(text);
  if (!block) return date ? { date, snow: null } : null;

  const snow = {};
  for (const line of block) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const hit = SNOW_ROWS.find(([label]) => trimmed.toUpperCase().startsWith(label));
    if (!hit) continue;

    const [label, key] = hit;
    if (snow[key] !== undefined) continue; // first occurrence wins

    // Everything after the label is the value table. The OBSERVED column is
    // the first token; the rest are record/normal/departure/last-year and are
    // not what the widget reports.
    const rest = trimmed.slice(label.length).trim();
    const first = rest.split(/\s+/)[0];
    snow[key] = cell(first);
  }

  return { date, snow: Object.keys(snow).length ? snow : null };
}

/**
 * Pull the most recent CLI product for a station.
 *
 * `fetchJson` is injected so the Worker's cached getJson is used in production
 * and a plain fetch in tests, rather than this module reaching for a global.
 */
export async function fetchCli(station, fetchJson) {
  const list = await fetchJson(
    `https://api.weather.gov/products/types/CLI/locations/${station}`,
    900
  );
  const first = list && list['@graph'] && list['@graph'][0];
  if (!first || !first.id) return null;

  const product = await fetchJson(`https://api.weather.gov/products/${first.id}`, 900);
  if (!product || !product.productText) return null;

  const parsed = parseCli(product.productText);
  if (!parsed) return null;

  return {
    ...parsed,
    station,
    issued: first.issuanceTime || null,
  };
}
