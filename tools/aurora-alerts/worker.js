/**
 * Aurora alert signup + conditional alert sender.
 *
 *   POST /subscribe          {email, region}  -> store as pending, send confirm mail
 *   GET  /confirm?t=<token>                   -> activate
 *   GET  /unsubscribe?t=<token>               -> unsubscribe
 *   GET  /stats                               -> counts only, no addresses
 *   cron                                      -> alert when conditions are actually good
 *
 * WHY A CONDITIONAL SENDER RATHER THAN A NEWSLETTER:
 * An aurora list that mails on a schedule trains people to ignore it. This
 * only sends when BOTH gates open for that subscriber's own region:
 *
 *   1. Tonight's forecast Kp clears that region's threshold, and
 *   2. at least one of the region's viewing spots is actually clear enough
 *      to see through.
 *
 * The thresholds differ by region because the geography does. The Upper
 * Peninsula sits near 55-57 deg geomagnetic latitude; Northern Lower Michigan
 * is about a degree and a half south, which is roughly one Kp level in
 * practice. Sending UP-grade alerts to Up North subscribers would be sending
 * them out to look at nothing.
 */

const ALERT_COOLDOWN_HOURS = 18; // at most one alert per region per night
const CLOUD_CEILING        = 60; // % — above this, nowhere in the region is worth a drive
const DARK_WINDOW          = {startHour: 22, hours: 4}; // 10 PM - 2 AM local

const REGIONS = {
  up: {
    label:    'the Upper Peninsula',
    short:    'UP',
    site:     'https://906dashboard.com',
    page:     'https://906dashboard.com/aurora.html',
    senderVar:'SENDER_UP',
    // Kp 5 (G1) is the point where aurora is usually naked-eye over Lake
    // Superior. Matches the FAIR/GOOD boundary on 906dashboard.com/aurora.html.
    kpThreshold: 5,
    spots: [
      {name:'Marquette',       lat:46.5436, lon:-87.3954},
      {name:'Copper Harbor',   lat:47.4687, lon:-87.8879},
      {name:'Whitefish Point', lat:46.6291, lon:-85.0367},
      {name:'Munising',        lat:46.4111, lon:-86.6498},
      {name:'Ironwood',        lat:46.4547, lon:-90.1710},
    ],
  },
  nlp: {
    label:    'Northern Michigan',
    short:    'Up North',
    site:     'https://upnorthdashboard.com',
    page:     'https://upnorthdashboard.com/aurora.html',
    senderVar:'SENDER_NLP',
    // One level higher than the UP: ~53-55 deg geomagnetic. Matches the
    // FAIR/GOOD boundary on upnorthdashboard.com/aurora.html.
    kpThreshold: 6,
    spots: [
      {name:'Mackinaw City (Headlands)', lat:45.7772, lon:-84.7767},
      {name:'Petoskey',                  lat:45.3733, lon:-84.9553},
      {name:'Old Mission Point',         lat:44.9906, lon:-85.4797},
      {name:'Presque Isle',              lat:45.3547, lon:-83.4907},
      {name:'Empire (Sleeping Bear)',    lat:44.8117, lon:-86.0578},
    ],
  },
};

const ALLOWED_ORIGINS = new Set([
  'https://906dashboard.com',
  'https://upnorthdashboard.com',
  'https://906dashboard.vercel.app',
  'https://upnorthdashboard.vercel.app',
]);

// ── small helpers ──
function cors(origin) {
  // Echo only origins we know, so this endpoint can't be driven from anywhere.
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://906dashboard.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}
const json = (obj, origin, status = 200) =>
  new Response(JSON.stringify(obj), {status, headers: cors(origin)});

function html(body, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>Aurora Alerts</title>
     <style>body{background:#0b1220;color:#e8eefb;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
     display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}
     .c{max-width:520px}h1{font-size:24px;margin:0 0 12px}p{color:#93a4c3;margin:0 0 18px}
     a{color:#37d5b2;font-weight:700}</style><div class="c">${body}</div>`,
    {status, headers: {'Content-Type': 'text/html; charset=utf-8'}}
  );
}

// Not a security boundary — just a sanity gate so obvious junk never reaches
// Resend and start hurting sender reputation with bounces.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function newToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nowISO = () => new Date().toISOString();

// ── Resend ──
async function sendResend(env, payload) {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = await r.text();
    // Never surface the provider's raw body to a caller — it can echo the key.
    throw new Error(`Resend HTTP ${r.status}` + (r.status === 401 ? ' (bad API key)' : '')
      + (detail.includes('domain') ? ' — sending domain may not be verified' : ''));
  }
  return r.json();
}

// Resend's batch endpoint takes up to 100 messages, each with its own body —
// which is what we need, because every message carries a unique unsubscribe
// token. Chunked so a large list still goes out in one cron run.
async function sendResendBatch(env, messages) {
  const out = {sent: 0, failed: 0};
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const r = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
      if (!r.ok) throw new Error(`Resend HTTP ${r.status}`);
      out.sent += chunk.length;
    } catch (e) {
      out.failed += chunk.length;
      out.error = e.message;
    }
  }
  return out;
}

// ── NOAA: tonight's peak Kp ──
async function tonightPeakKp() {
  const r = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json');
  if (!r.ok) throw new Error(`SWPC HTTP ${r.status}`);
  const rows = await r.json();

  // Same window the pages use: 6 PM -> 6 AM Eastern.
  const now = new Date();
  const start = new Date(now); start.setUTCHours(22, 0, 0, 0); // ~6 PM EDT
  const end   = new Date(start.getTime() + 12 * 3600 * 1000);

  let peak = 0, scale = null;
  const order = {G1:1, G2:2, G3:3, G4:4, G5:5};
  for (const d of rows) {
    if (d.observed === 'observed') continue;
    const t = new Date(d.time_tag + 'Z');
    if (t >= start && t <= end) {
      const kp = parseFloat(d.kp);
      if (kp > peak) peak = kp;
      if (d.noaa_scale && (!scale || order[d.noaa_scale] > order[scale])) scale = d.noaa_scale;
    }
  }
  return {peak, scale};
}

// ── NWS: cloud cover over the viewing window ──
function isoDurationMs(s) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(s || '');
  if (!m) return 3600000;
  return ((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60) * 1000;
}

async function spotCloud(spot) {
  try {
    const p = await (await fetch(`https://api.weather.gov/points/${spot.lat},${spot.lon}`,
      {headers: {'User-Agent': 'aurora-alerts/1.0 (+https://906dashboard.com)'}})).json();
    const g = await (await fetch(p.properties.forecastGridData,
      {headers: {'User-Agent': 'aurora-alerts/1.0 (+https://906dashboard.com)'}})).json();

    const start = new Date();
    start.setHours(DARK_WINDOW.startHour, 0, 0, 0);
    const end = new Date(start.getTime() + DARK_WINDOW.hours * 3600 * 1000);

    let total = 0, ms = 0;
    for (const v of (g.properties.skyCover.values || [])) {
      const [a, b] = String(v.validTime).split('/');
      const s = new Date(a), e = new Date(s.getTime() + isoDurationMs(b));
      const lo = Math.max(s.getTime(), start.getTime());
      const hi = Math.min(e.getTime(), end.getTime());
      if (hi > lo && v.value != null) { total += v.value * (hi - lo); ms += hi - lo; }
    }
    return {name: spot.name, pct: ms ? Math.round(total / ms) : null};
  } catch {
    return {name: spot.name, pct: null};
  }
}

async function clearestSpot(region) {
  const results = await Promise.all(region.spots.map(spotCloud));
  const usable = results.filter(r => r.pct != null).sort((a, b) => a.pct - b.pct);
  return usable.length ? usable[0] : null;
}

// ── email bodies ──
function shell(inner) {
  return `<div style="background:#0b1220;padding:28px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#16223a;border:1px solid #24345a;border-radius:14px;padding:26px;color:#e8eefb;line-height:1.6">
  ${inner}
  </div></div>`;
}

function confirmEmail(region, confirmUrl) {
  return shell(`
    <h1 style="font-size:21px;margin:0 0 12px">Confirm your ${esc(region.short)} aurora alerts</h1>
    <p style="color:#93a4c3;margin:0 0 18px">One click and you're on the list. We'll email you only when the northern lights are actually likely to be visible over ${esc(region.label)} — never on a schedule.</p>
    <p style="margin:0 0 22px"><a href="${confirmUrl}" style="display:inline-block;background:#37d5b2;color:#08101f;font-weight:800;padding:12px 22px;border-radius:10px;text-decoration:none">Confirm my subscription</a></p>
    <p style="color:#5f7196;font-size:13px;margin:0">If you didn't sign up, just ignore this — nothing happens without that click, and we won't email you again.</p>`);
}

function alertEmail(region, kp, scale, spot, unsubUrl) {
  const scaleTxt = scale ? ` (${esc(scale)})` : '';
  return shell(`
    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#37d5b2;font-weight:700;margin-bottom:10px">Aurora Alert · ${esc(region.short)}</div>
    <h1 style="font-size:23px;margin:0 0 12px">Tonight looks good for the northern lights</h1>
    <p style="color:#93a4c3;margin:0 0 18px">Forecast Kp for tonight is <strong style="color:#e8eefb">${kp.toFixed(1)}</strong>${scaleTxt}, above the threshold where aurora is usually visible from ${esc(region.label)} — and the sky is cooperating.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 18px;font-size:15px">
      <tr><td style="padding:9px 12px;background:#1b2a47;border-radius:8px 0 0 0;color:#93a4c3">Peak Kp tonight</td><td style="padding:9px 12px;background:#1b2a47;border-radius:0 8px 0 0;font-weight:700">${kp.toFixed(1)}${scaleTxt}</td></tr>
      <tr><td style="padding:9px 12px;background:#16223a;color:#93a4c3">Clearest sky</td><td style="padding:9px 12px;background:#16223a;font-weight:700">${esc(spot.name)} · ${spot.pct}% cloud</td></tr>
      <tr><td style="padding:9px 12px;background:#1b2a47;border-radius:0 0 0 8px;color:#93a4c3">Best window</td><td style="padding:9px 12px;background:#1b2a47;border-radius:0 0 8px 0;font-weight:700">10 PM – 2 AM</td></tr>
    </table>
    <p style="margin:0 0 22px"><a href="${esc(region.page)}" style="display:inline-block;background:#37d5b2;color:#08101f;font-weight:800;padding:12px 22px;border-radius:10px;text-decoration:none">See the live forecast &amp; best spots</a></p>
    <p style="color:#93a4c3;font-size:14px;margin:0 0 18px">Face north over open water, give your eyes 20–30 minutes to adjust, and be patient — the aurora arrives in waves 20–40 minutes apart.</p>
    <hr style="border:none;border-top:1px solid #24345a;margin:20px 0">
    <p style="color:#5f7196;font-size:12px;margin:0">You're getting this because you signed up for aurora alerts at ${esc(region.site)}.<br>
    <a href="${unsubUrl}" style="color:#5f7196">Unsubscribe</a> — one click, no questions.</p>`);
}

// ── routes ──
async function handleSubscribe(request, env, origin) {
  let body;
  try { body = await request.json(); } catch { return json({ok:false, error:'Bad request'}, origin, 400); }

  const email  = String(body.email || '').trim().toLowerCase();
  const region = String(body.region || '').trim();

  if (!EMAIL_RE.test(email))  return json({ok:false, error:'That email address doesn\'t look right.'}, origin, 400);
  if (!REGIONS[region])       return json({ok:false, error:'Unknown region.'}, origin, 400);
  if (body.website)           return json({ok:true}, origin); // honeypot: pretend success

  const r = REGIONS[region];
  const token = newToken();

  const existing = await env.DB.prepare(
    'SELECT id, status, token FROM subscribers WHERE email = ? AND region = ?'
  ).bind(email, region).first();

  if (existing && existing.status === 'active') {
    return json({ok:true, message:"You're already on the list for this region."}, origin);
  }

  if (existing) {
    // Re-subscribing, or never confirmed. Issue a fresh token and re-send.
    await env.DB.prepare(
      'UPDATE subscribers SET status = ?, token = ?, created_at = ?, unsubscribed_at = NULL WHERE id = ?'
    ).bind('pending', token, nowISO(), existing.id).run();
  } else {
    await env.DB.prepare(
      'INSERT INTO subscribers (email, region, status, token, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(email, region, 'pending', token, nowISO()).run();
  }

  const confirmUrl = `${new URL(request.url).origin}/confirm?t=${token}`;
  try {
    await sendResend(env, {
      from: env[r.senderVar],
      to: [email],
      subject: `Confirm your ${r.short} aurora alerts`,
      html: confirmEmail(r, confirmUrl),
    });
  } catch (e) {
    return json({ok:false, error:'Could not send the confirmation email. Try again shortly.', detail:e.message}, origin, 502);
  }

  return json({ok:true, message:'Check your inbox for a confirmation link.'}, origin);
}

async function handleConfirm(url, env) {
  const token = url.searchParams.get('t') || '';
  const row = await env.DB.prepare('SELECT id, region, status FROM subscribers WHERE token = ?').bind(token).first();
  if (!row) return html('<h1>Link not recognised</h1><p>It may have already been used or replaced by a newer signup.</p>', 404);

  if (row.status !== 'active') {
    await env.DB.prepare('UPDATE subscribers SET status = ?, confirmed_at = ? WHERE id = ?')
      .bind('active', nowISO(), row.id).run();
  }
  const r = REGIONS[row.region] || REGIONS.up;
  return html(`<h1>✅ You're on the list</h1>
    <p>We'll email you only when the northern lights are actually likely over ${esc(r.label)} — clear skies and enough activity to be worth going outside for.</p>
    <p><a href="${esc(r.page)}">See tonight's forecast →</a></p>`);
}

async function handleUnsubscribe(url, env) {
  const token = url.searchParams.get('t') || '';
  const row = await env.DB.prepare('SELECT id, region FROM subscribers WHERE token = ?').bind(token).first();
  if (!row) return html('<h1>Link not recognised</h1><p>You may already be unsubscribed.</p>', 404);

  await env.DB.prepare('UPDATE subscribers SET status = ?, unsubscribed_at = ? WHERE id = ?')
    .bind('unsubscribed', nowISO(), row.id).run();
  const r = REGIONS[row.region] || REGIONS.up;
  return html(`<h1>Unsubscribed</h1>
    <p>You won't get any more aurora alerts from us. No hard feelings.</p>
    <p><a href="${esc(r.site)}">Back to the dashboard →</a></p>`);
}

// ── the cron ──
// opts.forceKp / opts.ignoreCooldown exist so the whole pipeline — NOAA fetch,
// cloud lookups, subscriber query — can be exercised on a quiet night without
// waiting months for a real storm. Reachable only via /run-alerts with the
// admin key, and the send still requires real active subscribers.
async function runAlerts(env, opts = {}) {
  const summary = {ran: nowISO(), regions: {}, forced: !!opts.forceKp};

  let forecast;
  try { forecast = await tonightPeakKp(); }
  catch (e) { summary.error = e.message; return summary; }

  for (const [key, region] of Object.entries(REGIONS)) {
    const effectiveKp = opts.forceKp != null ? opts.forceKp : forecast.peak;
    const s = {peakKp: forecast.peak, effectiveKp, threshold: region.kpThreshold};

    if (effectiveKp < region.kpThreshold) { s.action = 'skip: Kp below threshold'; summary.regions[key] = s; continue; }

    const last = await env.DB.prepare(
      'SELECT sent_at FROM alert_log WHERE region = ? ORDER BY sent_at DESC LIMIT 1'
    ).bind(key).first();
    if (last && !opts.ignoreCooldown) {
      const hrs = (Date.now() - new Date(last.sent_at).getTime()) / 3600000;
      if (hrs < ALERT_COOLDOWN_HOURS) { s.action = `skip: alerted ${hrs.toFixed(1)}h ago`; summary.regions[key] = s; continue; }
    }

    const spot = await clearestSpot(region);
    s.clearest = spot;
    if (!spot || spot.pct > CLOUD_CEILING) { s.action = 'skip: nowhere clear enough'; summary.regions[key] = s; continue; }

    const subs = await env.DB.prepare(
      'SELECT email, token FROM subscribers WHERE region = ? AND status = ?'
    ).bind(key, 'active').all();
    const rows = subs.results || [];
    if (!rows.length) { s.action = 'skip: no active subscribers'; summary.regions[key] = s; continue; }

    const base = env.PUBLIC_BASE_URL || 'https://aurora-alerts.blomblog.workers.dev';
    const messages = rows.map(sub => {
      const unsub = `${base}/unsubscribe?t=${sub.token}`;
      return {
        from: env[region.senderVar],
        to: [sub.email],
        subject: `Aurora alert: tonight looks good over ${region.label}`,
        html: alertEmail(region, effectiveKp, forecast.scale, spot, unsub),
        // One-click unsubscribe. Mail providers weight this heavily, and
        // without it a list like this lands in Promotions or worse.
        headers: {
          'List-Unsubscribe': `<${unsub}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      };
    });

    const res = await sendResendBatch(env, messages);
    s.action = `sent ${res.sent}, failed ${res.failed}`;
    if (res.error) s.error = res.error;

    if (res.sent) {
      await env.DB.prepare(
        'INSERT INTO alert_log (region, sent_at, kp, best_spot, best_cloud, recipients) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(key, nowISO(), effectiveKp, spot.name, spot.pct, res.sent).run();
    }
    summary.regions[key] = s;
  }
  return summary;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return new Response(null, {headers: cors(origin)});

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      try { return await handleSubscribe(request, env, origin); }
      catch (e) { return json({ok:false, error:'Something went wrong. Try again shortly.', detail:e.message}, origin, 500); }
    }
    if (url.pathname === '/confirm')     return handleConfirm(url, env);
    if (url.pathname === '/unsubscribe') return handleUnsubscribe(url, env);

    // Counts only — never addresses. Safe to hit from anywhere.
    if (url.pathname === '/stats') {
      const rows = await env.DB.prepare(
        'SELECT region, status, COUNT(*) AS n FROM subscribers GROUP BY region, status'
      ).all();
      const last = await env.DB.prepare(
        'SELECT region, sent_at, kp, best_spot, recipients FROM alert_log ORDER BY sent_at DESC LIMIT 5'
      ).all();
      return json({ok:true, counts: rows.results || [], recentAlerts: last.results || []}, origin);
    }

    // Send one real alert-shaped email to a single address. Exists so the
    // Resend key and domain verification can be proven end to end without
    // mailing the actual list. Admin key required.
    if (url.pathname === '/test-send') {
      const key = url.searchParams.get('key') || '';
      if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ok:false, error:'Not authorised'}, origin, 401);
      const to     = (url.searchParams.get('to') || '').trim().toLowerCase();
      const rkey   = url.searchParams.get('region') || 'up';
      const region = REGIONS[rkey];
      if (!EMAIL_RE.test(to)) return json({ok:false, error:'Pass ?to=<email>'}, origin, 400);
      if (!region)            return json({ok:false, error:'Unknown region'}, origin, 400);
      const base  = env.PUBLIC_BASE_URL || 'https://aurora-alerts.blomblog.workers.dev';
      const unsub = `${base}/unsubscribe?t=TEST-TOKEN-NOT-REAL`;
      try {
        const res = await sendResend(env, {
          from: env[region.senderVar],
          to: [to],
          subject: `[test] Aurora alert preview — ${region.short}`,
          html: alertEmail(region, 7, 'G3', {name:'Test Spot', pct:12}, unsub),
          headers: {'List-Unsubscribe': `<${unsub}>`},
        });
        return json({ok:true, sentFrom: env[region.senderVar], to, id: res.id}, origin);
      } catch (e) {
        return json({ok:false, error:e.message, sentFrom: env[region.senderVar]}, origin, 502);
      }
    }

    // Manual dry-run of the cron, for testing. Requires the admin secret so a
    // stranger can't trigger a real send.
    if (url.pathname === '/run-alerts') {
      const key = url.searchParams.get('key') || '';
      if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) return json({ok:false, error:'Not authorised'}, origin, 401);
      const forceKp = url.searchParams.has('forceKp') ? parseFloat(url.searchParams.get('forceKp')) : null;
      return json({ok:true, summary: await runAlerts(env, {
        forceKp,
        ignoreCooldown: url.searchParams.get('ignoreCooldown') === '1',
      })}, origin);
    }

    return json({ok:false, error:'Not found. Use /subscribe, /confirm, /unsubscribe or /stats'}, origin, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlerts(env));
  },
};
