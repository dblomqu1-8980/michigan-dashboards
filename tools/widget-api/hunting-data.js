/**
 * Hunting reference data, lifted from sites/906/hunting.html.
 *
 * HTML entities are decoded on extraction: the page holds "&amp;" because it
 * renders these through innerHTML, but this file feeds a JSON payload where
 * the raw ampersand is what belongs. Re-decode if you re-extract.
 *
 * Extracted mechanically rather than retyped, because these are legal dates
 * and legal hours: a transcription slip here tells someone they may shoot when
 * they may not. If the page's tables change, re-extract rather than hand-edit,
 * and keep the two in step — the widget and the page must never disagree about
 * a season date on the same day.
 *
 * Source of record for all of it is the Michigan DNR digest, linked per entry.
 */

const COUNTIES = [
  { name:'Alger',       seat:'Munising',         lat:46.411, lon:-86.648, ct:false },
  { name:'Baraga',      seat:"L'Anse",           lat:46.756, lon:-88.451, ct:false },
  { name:'Chippewa',    seat:'Sault Ste. Marie', lat:46.495, lon:-84.345, ct:false },
  { name:'Delta',       seat:'Escanaba',         lat:45.745, lon:-87.064, ct:false, antlerless:'partial' },
  { name:'Dickinson',   seat:'Iron Mountain',    lat:45.820, lon:-88.065, ct:true,  antlerless:'partial', cwd:true },
  { name:'Gogebic',     seat:'Bessemer',         lat:46.481, lon:-90.053, ct:true },
  { name:'Houghton',    seat:'Houghton',         lat:47.121, lon:-88.569, ct:false },
  { name:'Iron',        seat:'Crystal Falls',    lat:46.098, lon:-88.334, ct:true,  antlerless:'partial' },
  { name:'Keweenaw',    seat:'Eagle River',      lat:47.412, lon:-88.298, ct:false, note:'Isle Royale, part of Keweenaw County, is closed to hunting and trapping.' },
  { name:'Luce',        seat:'Newberry',         lat:46.355, lon:-85.510, ct:false },
  { name:'Mackinac',    seat:'St. Ignace',       lat:45.868, lon:-84.728, ct:false },
  { name:'Marquette',   seat:'Marquette',        lat:46.543, lon:-87.395, ct:false },
  { name:'Menominee',   seat:'Menominee',        lat:45.108, lon:-87.614, ct:true,  antlerless:'partial' },
  { name:'Ontonagon',   seat:'Ontonagon',        lat:46.871, lon:-89.315, ct:false },
  { name:'Schoolcraft', seat:'Manistique',       lat:45.957, lon:-86.247, ct:false },
];

const HOURS = {
  general:  { open:-30, close:+30, label:'½ hr before sunrise → ½ hr after sunset',
              src:'https://www.michigan.gov/dnr/managing-resources/laws/regulations/deer' },
  woodcock: { open:0,   close:0,   label:'Sunrise → sunset',
              src:'https://www.michigan.gov/dnr/managing-resources/laws/regulations/small-game' },
  waterfowl:{ open:-30, close:0,   label:'½ hr before sunrise → sunset',
              src:'https://www.michigan.gov/dnr/managing-resources/laws/regulations/waterfowl' },
  teal:     { open:0,   close:0,   label:'Sunrise → sunset (early teal only)',
              src:'https://www.michigan.gov/dnr/managing-resources/laws/regulations/waterfowl' },
  furbearer:{ open:-30, close:+30, label:'½ hr before sunrise → ½ hr after sunset, plus regulated night hunting',
              src:'https://www.michigan.gov/dnr/managing-resources/laws/regulations/fur-harvester' },
};

const DEER_SRC  = 'https://www.michigan.gov/dnr/managing-resources/laws/regulations/deer';
const SG_SRC    = 'https://www.michigan.gov/dnr/managing-resources/laws/regulations/small-game';
const WF_SRC    = 'https://www.michigan.gov/dnr/managing-resources/laws/regulations/waterfowl';
const BEAR_SRC  = 'https://www.michigan.gov/dnr/managing-resources/laws/regulations/bear';
const TURK_SRC  = 'https://www.michigan.gov/dnr/managing-resources/laws/regulations/fall-turkey';
const FUR_SRC   = 'https://www.michigan.gov/dnr/managing-resources/laws/regulations/fur-harvester';
const CAL_SRC   = 'https://www.michigan.gov/dnr/things-to-do/hunting/hunting-season-calendar';


const SEASONS = [
  { name:'Archery deer', icon:'🏹', hours:'general', src:DEER_SRC,
    ranges:[['2026-10-01','2026-11-14'],['2026-12-01','2027-01-01']],
    note:'Crossbows legal in the early segment. In late archery they need a disability bow permit — or, new for 2026, a resident senior license.' },
  { name:'Liberty Hunt', icon:'🎗️', hours:'general', src:DEER_SRC,
    ranges:[['2026-09-12','2026-09-13']],
    note:'Youth and hunters with qualifying disabilities. Antler point restrictions do not apply.' },
  { name:'Early antlerless firearm', icon:'🎯', hours:'general', src:DEER_SRC,
    ranges:[['2026-09-12','2026-09-13']],
    note:'Moved onto the Liberty Hunt weekend for 2026.' },
  { name:'Independence Hunt', icon:'♿', hours:'general', src:DEER_SRC,
    ranges:[['2026-10-15','2026-10-18']],
    note:'Hunters with qualifying disabilities. One deer, antlered or antlerless.' },
  { name:'Regular firearm deer', icon:'🦌', hours:'general', src:DEER_SRC,
    ranges:[['2026-11-15','2026-11-30']],
    note:'All legal firearms. Crossbows are legal during firearm season in the UP.' },
  { name:'Muzzleloader deer (UP DMUs)', icon:'💨', hours:'general', src:DEER_SRC,
    ranges:[['2026-12-04','2026-12-06']],
    note:"The DNR's 2026 season calendar lists Dec. 4–6; one FAQ answer in the digest still shows older dates. Confirm in your digest before you go." },
  { name:'Bear', icon:'🐻', hours:'general', src:BEAR_SRC,
    ranges:[['2026-09-09','2026-10-26']],
    note:'UP BMUs — Amasa, Baraga, Bergland, Carney, Drummond Island, Gwinn and Newberry. Hunt period 1 opens Sept. 9, period 2 Sept. 14, period 3 Sept. 25. Licensed by quota drawing.' },
  { name:'Ruffed grouse', icon:'🐦', hours:'general', src:SG_SRC,
    ranges:[['2026-09-15','2026-11-14'],['2026-12-01','2027-01-01']],
    note:'Bag limit 5 daily, 10 in possession in Zone 1.' },
  { name:'American woodcock', icon:'🪶', hours:'woodcock', src:SG_SRC,
    ranges:[['2026-09-15','2026-10-29']],
    note:'Sunrise to sunset — not the general hours. Free woodcock stamp and a current HIP endorsement required. Bag limit 3 daily.' },
  { name:'Fall turkey', icon:'🦃', hours:'general', src:TURK_SRC,
    ranges:[['2026-09-15','2026-11-14']],
    note:'TMU I and TMU M. Check the TMU map for the unit covering your ground.' },
  { name:'Sharp-tailed grouse (Zone 1)', icon:'🌾', hours:'general', src:SG_SRC,
    ranges:[['2026-10-10','2026-10-31']],
    note:'Upper Peninsula only, and only in the open area. Free sharp-tailed grouse stamp required. Bag limit 2 daily, 6 for the season.' },
  { name:'Ring-necked pheasant (Zone 1)', icon:'🐓', hours:'general', src:SG_SRC,
    ranges:[['2026-10-10','2026-10-31']],
    note:'UP pheasant unit. Bag limit 2 daily.' },
  { name:'Fox & gray squirrel', icon:'🐿️', hours:'general', src:SG_SRC,
    ranges:[['2026-09-15','2027-03-31']],
    note:'Black-phase gray squirrels included. Bag limit 5 daily.' },
  { name:'Cottontail rabbit & snowshoe hare', icon:'🐇', hours:'general', src:SG_SRC,
    ranges:[['2026-09-15','2027-03-31']],
    note:'Bag limit 5 daily, 10 in possession combined.' },
  { name:'Duck, coot & merganser (North Zone)', icon:'🦆', hours:'waterfowl', src:WF_SRC,
    ranges:[['2026-09-26','2026-11-22'],['2026-11-28','2026-11-29']],
    note:'The entire UP is in the waterfowl North Zone. Federal duck stamp and HIP endorsement required.' },
  { name:'Dark & light goose (North Zone)', icon:'🪿', hours:'waterfowl', src:WF_SRC,
    ranges:[['2026-09-01','2026-12-16']],
    note:'North Zone dates. Bag limits differ between dark and light geese.' },
  { name:'Early teal', icon:'🦆', hours:'teal', src:WF_SRC,
    ranges:[['2026-09-01','2026-09-09']],
    note:'Blue-winged and green-winged teal only, and hours are sunrise to sunset rather than the regular waterfowl hours.' },
  { name:"Rails, gallinule & Wilson's snipe", icon:'🐦‍⬛', hours:'waterfowl', src:WF_SRC,
    ranges:[['2026-09-01','2026-11-09']],
    note:'Statewide season. HIP endorsement required.' },
  { name:'Coyote', icon:'🐺', hours:'furbearer', src:FUR_SRC,
    ranges:[['2026-10-15','2027-03-01']],
    note:'Night hunting is legal under the furbearer nighttime rules. A separate management season runs Mar. 2 – Oct. 14.' },
  { name:'Crow', icon:'🐦‍⬛', hours:'general', src:SG_SRC,
    ranges:[['2026-08-01','2026-09-30'],['2027-02-01','2027-03-31']],
    note:'No bag limit.' },
];

export { COUNTIES, HOURS, SEASONS };
