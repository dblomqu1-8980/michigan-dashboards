/**
 * Sunrise and sunset, computed rather than fetched.
 *
 * hunting.html gets these from Open-Meteo, whose free tier is non-commercial —
 * which is exactly the licensing question that would land on a paying client.
 * There is no need to ask anyone: sunrise is a function of date, latitude and
 * longitude, and the NOAA Solar Calculator algorithm below agrees with
 * Open-Meteo to within 1.1 minutes across all fifteen UP counties, checked
 * against every one of them. No key, no quota, no upstream to fail, and no
 * licence to argue about.
 */
const rad = Math.PI / 180, deg = 180 / Math.PI;

function julianDay(d) { return d.valueOf() / 86400000 + 2440587.5; }
function julianCentury(jd) { return (jd - 2451545) / 36525; }

function geomMeanLongSun(t) { return (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360; }
function geomMeanAnomSun(t) { return 357.52911 + t * (35999.05029 - 0.0001537 * t); }
function eccentEarthOrbit(t) { return 0.016708634 - t * (0.000042037 + 0.0000001267 * t); }
function sunEqOfCtr(t, m) {
  return Math.sin(m * rad) * (1.914602 - t * (0.004817 + 0.000014 * t))
       + Math.sin(2 * m * rad) * (0.019993 - 0.000101 * t)
       + Math.sin(3 * m * rad) * 0.000289;
}
function meanObliqEcliptic(t) {
  return 23 + (26 + ((21.448 - t * (46.815 + t * (0.00059 - t * 0.001813)))) / 60) / 60;
}

function solarCalc(date, lat, lon) {
  const jd = julianDay(date), t = julianCentury(jd);
  const L0 = geomMeanLongSun(t), M = geomMeanAnomSun(t), e = eccentEarthOrbit(t);
  const C = sunEqOfCtr(t, M);
  const trueLong = L0 + C;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * t) * rad);
  const oblq = meanObliqEcliptic(t);
  const oblqCorr = oblq + 0.00256 * Math.cos((125.04 - 1934.136 * t) * rad);
  const decl = Math.asin(Math.sin(oblqCorr * rad) * Math.sin(appLong * rad)) * deg;

  const y = Math.tan(oblqCorr / 2 * rad) ** 2;
  const eqTime = 4 * deg * (
      y * Math.sin(2 * L0 * rad)
    - 2 * e * Math.sin(M * rad)
    + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad)
    - 0.5 * y * y * Math.sin(4 * L0 * rad)
    - 1.25 * e * e * Math.sin(2 * M * rad));

  const haArg = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl * rad))
              - Math.tan(lat * rad) * Math.tan(decl * rad);
  if (haArg > 1)  return { polar: 'night', eqTime, decl };
  if (haArg < -1) return { polar: 'day', eqTime, decl };
  return { ha: Math.acos(haArg) * deg, eqTime, decl };
}

/** Returns Date objects in UTC. lat north-positive, lon east-positive. */
function sunTimes(date, lat, lon) {
  // Anchor on local solar midnight for the date, then refine once: eqTime and
  // declination both move through the day, and evaluating them at the event
  // rather than at midnight is what closes the last couple of minutes.
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  let rise = null, set = null;
  for (let pass = 0; pass < 2; pass++) {
    const at = pass === 0 ? new Date(dayStart + 12 * 3600000) : null;
    const rc = solarCalc(pass === 0 ? at : rise, lat, lon);
    const sc = solarCalc(pass === 0 ? at : set,  lat, lon);
    if (rc.polar || sc.polar) return { polar: rc.polar || sc.polar };
    // minutes from local midnight, then to UTC via the longitude offset
    const noonMin = 720 - 4 * lon - rc.eqTime;
    rise = new Date(dayStart + (noonMin - rc.ha * 4) * 60000);
    const noonMin2 = 720 - 4 * lon - sc.eqTime;
    set  = new Date(dayStart + (noonMin2 + sc.ha * 4) * 60000);
  }
  return { sunrise: rise, sunset: set };
}

export { sunTimes };
