/**
 * Ski areas and climate stations for the ski widget.
 *
 * EXTRACTED, NOT RETYPED — same rule hunting-data.js states and for a weaker
 * but still real reason: these are the coordinates a snow forecast is pulled
 * for and the links a visitor is sent to. A transposed digit moves a hill into
 * the next county and quietly reports the wrong mountain's weather.
 *
 * Source of truth is the AREAS array in each page:
 *   up  -> sites/906/ski.html
 *   nlp -> sites/upnorth/ski.html
 *
 * Re-extract by walking the bracket depth of `const AREAS = [` in each file
 * rather than by hand. Only the fields the widget actually needs are kept:
 * the pages' marketing prose, vertical drop and trail counts stay on the pages.
 *
 * Generated 2026-10-07 — 34 areas across both regions.
 */

/**
 * Climate stations, one per region.
 *
 * This is the regional compromise the widget is built on. Snow DEPTH is only
 * published in NWS CLI products, and Michigan has exactly three CLI sites —
 * Marquette, Gaylord and Grand Rapids. So depth is the climate station's, not
 * the hill's, and `stationName` exists so the widget can say so out loud
 * instead of implying a reading from the summit.
 *
 * Forecast snowfall is NOT regional: that comes from the gridpoint for each
 * area's own coordinates, so "how much is coming" is per-hill even though
 * "what is on the ground" is per-region.
 *
 * Verified 2026-10-07: MQT publishes the full snow block (depth, yesterday,
 * month-to-date, season-to-date). APX publishes only YESTERDAY in October.
 * Treat every field as optional — see cli.js.
 */
export const REGIONS = {
  up:  { station: 'MQT', stationName: 'Marquette', label: 'Upper Peninsula',
         lat: 46.5436, lon: -87.3954,
         page: 'https://906dashboard.com/ski.html' },
  nlp: { station: 'APX', stationName: 'Gaylord', label: 'Northern Michigan',
         lat: 45.0275, lon: -84.6747,
         page: 'https://upnorthdashboard.com/ski.html' },
};

export const AREAS = {
  up: [
  { id: "bohemia", type: "downhill", name: "Mount Bohemia",
    town: "Lac La Belle · Keweenaw", lat: 47.3833, lon: -88.0167,
    url: "https://www.mtbohemia.com/conditions/" },
  { id: "snowriver", type: "downhill", name: "Snowriver Mountain Resort",
    town: "Wakefield · Gogebic", lat: 46.4744, lon: -89.9548,
    url: "https://www.snowriver.com/" },
  { id: "powderhorn", type: "downhill", name: "Big Powderhorn Mountain",
    town: "Bessemer · Gogebic", lat: 46.4869, lon: -90.0854,
    url: "https://www.bigpowderhorn.net/mountain/snow-report/" },
  { id: "ripley", type: "downhill", name: "Mont Ripley",
    town: "Hancock · Houghton", lat: 47.1258, lon: -88.5636,
    url: "https://www.mtu.edu/mont-ripley/" },
  { id: "marquette", type: "downhill", name: "Marquette Mountain",
    town: "Marquette · Marquette", lat: 46.5133, lon: -87.4197,
    url: "https://www.marquettemountain.com/conditions/" },
  { id: "brule", type: "downhill", name: "Ski Brule",
    town: "Iron River · Iron", lat: 46.0155, lon: -88.6547,
    url: "https://www.skibrule.com/conditions/" },
  { id: "pine", type: "downhill", name: "Pine Mountain",
    town: "Iron Mountain · Dickinson", lat: 45.8397, lon: -88.0956,
    url: "https://www.pinemountainresort.com/mountain/conditions/" },
  { id: "porkies", type: "downhill", name: "Porcupine Mountains",
    town: "Ontonagon · Ontonagon", lat: 46.8153, lon: -89.7392,
    url: "https://www.michigan.gov/dnr/places/state-parks/porcupine-mountains" },
  { id: "norway", type: "downhill", name: "Norway Mountain",
    town: "Norway · Dickinson", lat: 45.7897, lon: -87.9042,
    url: "https://www.norwaymountain.com/" },
  { id: "zion", type: "downhill", name: "Mount Zion",
    town: "Ironwood · Gogebic", lat: 46.4692, lon: -90.1719,
    url: "https://gogebic.edu/mount-zion/" },
  { id: "abr", type: "nordic", name: "ABR Trails",
    town: "Ironwood · Gogebic", lat: 46.4581, lon: -90.1275,
    url: "https://www.abrski.com/" },
  { id: "valleyspur", type: "nordic", name: "Valley Spur",
    town: "Munising · Alger", lat: 46.3486, lon: -86.7042,
    url: "https://www.valleyspur.org/" },
  { id: "swedetown", type: "nordic", name: "Swedetown Trails",
    town: "Calumet · Houghton", lat: 47.2325, lon: -88.4517,
    url: "https://www.swedetowntrails.org/" },
  { id: "blueberry", type: "nordic", name: "Blueberry Ridge Pathway",
    town: "Marquette · Marquette", lat: 46.4906, lon: -87.4536,
    url: "https://www.michigan.gov/dnr/things-to-do/skiing" },
  { id: "mtu", type: "nordic", name: "Michigan Tech Trails",
    town: "Houghton · Houghton", lat: 47.1075, lon: -88.5453,
    url: "https://www.mtu.edu/trails/" },
  { id: "maasto", type: "nordic", name: "Maasto Hiihto & Churning Rapids",
    town: "Hancock · Houghton", lat: 47.135, lon: -88.59,
    url: "https://www.keweenawnordicskiclub.org/" },
  { id: "wolverine", type: "nordic", name: "Wolverine Nordic Trails",
    town: "Ironwood · Gogebic", lat: 46.4494, lon: -90.1719,
    url: "https://wolverinenordic.com/" },
  ],
  nlp: [
  { id: "boyne", type: "downhill", name: "Boyne Mountain",
    town: "Boyne Falls · Charlevoix", lat: 45.1636, lon: -84.9308,
    url: "https://www.boynemountain.com/" },
  { id: "highlands", type: "downhill", name: "The Highlands",
    town: "Harbor Springs · Emmet", lat: 45.4767, lon: -84.9297,
    url: "https://www.highlandsharborsprings.com/" },
  { id: "nubs", type: "downhill", name: "Nub's Nob",
    town: "Harbor Springs · Emmet", lat: 45.4831, lon: -84.9111,
    url: "https://www.nubsnob.com/" },
  { id: "crystal", type: "downhill", name: "Crystal Mountain",
    town: "Thompsonville · Benzie", lat: 44.5197, lon: -85.9822,
    url: "https://www.crystalmountain.com/ski/cams-conditions/mountain-report" },
  { id: "shanty", type: "downhill", name: "Shanty Creek",
    town: "Bellaire · Antrim", lat: 44.9092, lon: -85.1936,
    url: "https://www.shantycreek.com/" },
  { id: "caberfae", type: "downhill", name: "Caberfae Peaks",
    town: "Cadillac · Wexford", lat: 44.2589, lon: -85.7392,
    url: "https://caberfaepeaks.com/snow-report/" },
  { id: "otsego", type: "downhill", name: "Otsego Resort",
    town: "Gaylord · Otsego", lat: 45.0439, lon: -84.6606,
    url: "https://www.otsegoresort.com/" },
  { id: "treetops", type: "downhill", name: "Treetops Resort",
    town: "Gaylord · Otsego", lat: 45.0733, lon: -84.5828,
    url: "https://www.treetops.com/" },
  { id: "hanson", type: "downhill", name: "Hanson Hills",
    town: "Grayling · Crawford", lat: 44.6489, lon: -84.7481,
    url: "https://hansonhills.org/" },
  { id: "mcsauba", type: "downhill", name: "Mt. McSauba",
    town: "Charlevoix · Charlevoix", lat: 45.3253, lon: -85.2597,
    url: "https://www.cityofcharlevoix.org/" },
  { id: "vasa", type: "nordic", name: "VASA Pathway",
    town: "Williamsburg · Grand Traverse", lat: 44.7431, lon: -85.4703,
    url: "https://www.traversetrails.org/trail/vasa-pathway/" },
  { id: "forbush", type: "nordic", name: "Forbush Corner",
    town: "Frederic · Crawford", lat: 44.7561, lon: -84.6689,
    url: "https://forbushcorner.com/" },
  { id: "hansonxc", type: "nordic", name: "Hanson Hills Nordic",
    town: "Grayling · Crawford", lat: 44.6489, lon: -84.7481,
    url: "https://hansonhills.org/" },
  { id: "xchq", type: "nordic", name: "Cross Country Ski HQ",
    town: "Roscommon · Roscommon", lat: 44.5578, lon: -84.6483,
    url: "https://www.crosscountryski.com/" },
  { id: "corsair", type: "nordic", name: "Corsair Trails",
    town: "Tawas City · Iosco", lat: 44.4269, lon: -83.8461,
    url: "https://www.corsairtrails.org/" },
  { id: "hartwick", type: "nordic", name: "Hartwick Pines State Park",
    town: "Grayling · Crawford", lat: 44.7444, lon: -84.6511,
    url: "https://www.michigan.gov/dnr/places/state-parks/hartwick-pines" },
  { id: "crystalxc", type: "nordic", name: "Crystal Mountain Nordic",
    town: "Thompsonville · Benzie", lat: 44.5197, lon: -85.9822,
    url: "https://www.crystalmountain.com/ski/cross-country" },
  ],
};

/** Flat lookup across both regions; ids are unique within a region, not across. */
export function findArea(region, id) {
  const list = AREAS[region];
  if (!list) return null;
  return list.find((a) => a.id === id) || null;
}
