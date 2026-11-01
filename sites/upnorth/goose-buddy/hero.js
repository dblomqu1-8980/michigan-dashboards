(function (root) {
  'use strict';
  const CITIES = {
    traversecity:{name:'Traverse City',lat:44.7631,lon:-85.6206,zone:'America/Detroit',station:'KTVC'},
    petoskey:{name:'Petoskey',lat:45.3733,lon:-84.9553,zone:'America/Detroit',station:'KPLN'},
    gaylord:{name:'Gaylord',lat:45.0275,lon:-84.6748,zone:'America/Detroit',station:'KGLR'},
    alpena:{name:'Alpena',lat:45.0617,lon:-83.4328,zone:'America/Detroit',station:'KAPN'},
    cadillac:{name:'Cadillac',lat:44.2519,lon:-85.4012,zone:'America/Detroit',station:'KCAD'},
    charlevoix:{name:'Charlevoix',lat:45.3181,lon:-85.2584,zone:'America/Detroit',station:'KCVX'},
    houghtonlake:{name:'Houghton Lake',lat:44.3147,lon:-84.7648,zone:'America/Detroit',station:'KHTL'},
    manistee:{name:'Manistee',lat:44.2444,lon:-86.3243,zone:'America/Detroit',station:'KMBL'},
    mackinawcity:{name:'Mackinaw City',lat:45.7775,lon:-84.7278,zone:'America/Detroit'},
    mackinacisland:{name:'Mackinac Island',lat:45.8492,lon:-84.6189,zone:'America/Detroit'},
    grayling:{name:'Grayling',lat:44.6614,lon:-84.7148,zone:'America/Detroit'},
    frankfort:{name:'Frankfort',lat:44.6333,lon:-86.2345,zone:'America/Detroit'}
  };
  function fahrenheit(value, unit='wmoUnit:degC') {
    if(value===null||value===undefined||!Number.isFinite(Number(value))) return null;
    return Math.round(/^(f|degf|fahrenheit)$|degf/i.test(unit)?Number(value):Number(value)*9/5+32);
  }
  function mph(value, unit='') {
    if(value===null||value===undefined||!Number.isFinite(Number(value))) return null;
    if(/m_s|m\/s/i.test(unit)) return Math.round(Number(value)*2.236936);
    if(/mph|mi_h/i.test(unit)) return Math.round(Number(value));
    if(/km_h|km\/h/i.test(unit)) return Math.round(Number(value)*0.621371);
    if(/\bkt\b|knots?|wmoUnit:kn/i.test(unit)) return Math.round(Number(value)*1.15078);
    return null;
  }
  function look(w) {
    const description=String(w.description||'').toLowerCase();
    if(/snow|sleet|blizzard|flurr|ice pellets/.test(description))return {outfit:'winter',scene:'snow',speech:'Ope! Looks like a snow day.',alt:'a winter coat and scarf'};
    if(/rain|drizzle|shower|thunder/.test(description))return {outfit:'rain',scene:'rain',speech:'Don’t forget your raincoat, eh?',alt:'a raincoat and holding an umbrella'};
    const windy=(w.windMph||0)>=18||/windy|breezy|gust/.test(description);
    if(w.temperature<=45)return {outfit:'winter',scene:windy?'wind':'calm',speech:windy?'Bundle up—it’s windy out there.':'A little chilly out there, eh?',alt:'a winter coat and scarf'};
    if(windy)return {outfit:'wind',scene:'wind',speech:'Hold onto your hat, eh?',alt:'flannel with a scarf blowing in the wind'};
    if(w.temperature<=62)return {outfit:'wind',scene:'calm',speech:'A good day for a little flannel.',alt:'flannel and a scarf'};
    return {outfit:'summer',scene:'calm',speech:'A fine day to be Up North.',alt:'a summer vest and sunglasses'};
  }
  function timeInZone(zone,date=new Date()) {
    return new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true}).format(date);
  }
  // Approximate solar elevation is sufficient for the scene's day/night colors.
  function isDaylight(city,date=new Date()) {
    const rad=Math.PI/180,jd=date.getTime()/86400000+2440587.5,n=jd-2451545;
    const meanLongitude=(280.460+0.9856474*n)*rad, meanAnomaly=(357.528+0.9856003*n)*rad;
    const ecliptic=meanLongitude+(1.915*Math.sin(meanAnomaly)+0.020*Math.sin(2*meanAnomaly))*rad;
    const obliquity=(23.439-0.0000004*n)*rad;
    const declination=Math.asin(Math.sin(obliquity)*Math.sin(ecliptic));
    const rightAscension=Math.atan2(Math.cos(obliquity)*Math.sin(ecliptic),Math.cos(ecliptic));
    const hourAngle=(280.46061837+360.98564736629*n+city.lon)*rad-rightAscension;
    const latitude=city.lat*rad;
    const altitude=Math.asin(Math.sin(latitude)*Math.sin(declination)+Math.cos(latitude)*Math.cos(declination)*Math.cos(hourAngle))/rad;
    return altitude>-0.833;
  }
  function observation(p,station,now=Date.now()) {
    if(!p||typeof p!=='object')return null;
    const temperature=fahrenheit(p.temperature?.value,p.temperature?.unitCode);
    const stamp=Date.parse(p.timestamp||'');
    if(temperature===null||!Number.isFinite(stamp)||now-stamp>3*60*60*1000||now-stamp< -10*60*1000)return null;
    return {kind:'observation',temperature,description:p.textDescription||'Current conditions',windMph:mph(p.windSpeed?.value,p.windSpeed?.unitCode),time:p.timestamp,station};
  }
  const logic={CITIES,fahrenheit,mph,look,timeInZone,isDaylight,observation};
  if(typeof module!=='undefined'&&module.exports)module.exports=logic;
  if(typeof document==='undefined')return;

  const el=id=>document.getElementById(id);
  if(!el('goose-stage'))return;
  const stationCache=new Map();
  let saved=null;
  try{saved=localStorage.getItem('upnorth-goose-city');}catch{}
  let cityKey=Object.hasOwn(CITIES,saved)?saved:'traversecity';
  let current=null,sequence=0,inFlightToken=null;
  const selector=el('goose-city');selector.textContent='';
  Object.entries(CITIES).forEach(([key,city])=>{const option=document.createElement('option');option.value=key;option.textContent=city.name+', MI';selector.appendChild(option);});
  selector.value=cityKey;
  const setText=(id,text)=>{el(id).textContent=text;};
  function clock(){setText('goose-clock',timeInZone(CITIES[cityKey].zone));}
  function fresh(w){
    if(!w||!Number.isFinite(Date.parse(w.time)))return false;
    const maxAge=w.kind==='observation'?3*60*60*1000:90*60*1000;
    return Date.now()-Date.parse(w.time)<=maxAge;
  }
  function showLoading(){
    setText('goose-status','● CHECKING THE SKY');setText('goose-temp','—');setText('goose-unit','');
    setText('goose-description','Looking outside...');setText('goose-source','National Weather Service');
    setText('goose-quote','“Honk! Checking the weather...”');el('goose-stage').dataset.weather='loading';
    el('goose-mascot').alt='A friendly porch goose checking the weather';clock();
  }
  function showUnavailable(){
    setText('goose-status','● WEATHER UNAVAILABLE');setText('goose-temp','—');setText('goose-unit','');
    setText('goose-description','Please try again soon');setText('goose-source','NWS data is unavailable');
    setText('goose-quote','“Ope! Let’s try that again.”');el('goose-stage').dataset.weather='loading';
    el('goose-mascot').alt='A friendly porch goose checking the weather';
  }
  function show(w){
    current=w;const city=CITIES[cityKey],style=look(w),stage=el('goose-stage');
    stage.dataset.weather=style.scene;stage.classList.toggle('is-night',!isDaylight(city));stage.classList.toggle('is-cloudy',/cloud|overcast|fog|mist/i.test(w.description));
    const image=el('goose-mascot');const src='/goose-buddy/goose-'+style.outfit+'.webp';
    if(image.getAttribute('src')!==src)image.setAttribute('src',src);
    image.alt='Friendly porch goose wearing '+style.alt;
    setText('goose-quote','“'+style.speech+'”');setText('goose-temp',String(w.temperature));setText('goose-unit','°F');
    setText('goose-description',w.description);
    setText('goose-status',w.kind==='observation'?'● LATEST OBSERVATION':'● HOURLY FORECAST');
    const when=new Intl.DateTimeFormat('en-US',{timeZone:city.zone,hour:'numeric',minute:'2-digit'}).format(new Date(w.time));
    setText('goose-source',w.kind==='observation'?'NWS '+w.station+' · '+when+(w.conditionForecast?' · forecast sky':''):'NWS forecast · '+when);
  }
  async function json(url){
    const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='api.weather.gov')throw new Error('Untrusted weather endpoint');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{const r=await fetch(url,{headers:{Accept:'application/geo+json, application/json'},signal:controller.signal});if(!r.ok)throw new Error('Weather unavailable');return await r.json();}finally{clearTimeout(timer);}
  }
  async function fallback(token,includeStations){
    if(inFlightToken===token)return;inFlightToken=token;
    const key=cityKey,city=CITIES[key];
    try{
      const point=await json(`https://api.weather.gov/points/${city.lat},${city.lon}`);
      const p=point.properties||{};
      const requests=[p.forecastHourly?json(p.forecastHourly):Promise.reject(new Error('No forecast'))];
      if(includeStations)requests.push(p.observationStations?json(p.observationStations):Promise.reject(new Error('No station')));
      const results=await Promise.allSettled(requests),hour=results[0].status==='fulfilled'?results[0].value?.properties?.periods?.[0]:null;
      let stationWeather=null;
      if(includeStations&&results[1]?.status==='fulfilled'){
        const stationUrl=results[1].value?.features?.[0]?.id;
        if(stationUrl){try{stationWeather=observation((await json(stationUrl+'/observations/latest')).properties,stationUrl.split('/').pop());}catch{}}
      }
      if(token!==sequence||cityKey!==key)return;
      if(stationWeather){
        if(stationWeather.description==='Current conditions'&&hour?.shortForecast){stationWeather.description=hour.shortForecast;stationWeather.conditionForecast=true;}
        show(stationWeather);return;
      }
      const temp=hour?fahrenheit(hour.temperature,hour.temperatureUnit):null;
      if(temp===null||!hour?.startTime||!Number.isFinite(Date.parse(hour.startTime)))throw new Error('No forecast');
      if(current?.kind==='observation'&&current.description==='Current conditions'&&hour.shortForecast)show({...current,description:hour.shortForecast,conditionForecast:true});
      else if(current?.kind!=='observation'||!fresh(current))show({kind:'forecast',temperature:temp,description:hour.shortForecast||'Hourly forecast',windMph:parseInt(hour.windSpeed||'0',10)||0,time:hour.startTime});
    }catch(e){if(token===sequence&&cityKey===key&&!fresh(current)){current=null;showUnavailable();}}
    finally{if(inFlightToken===token)inFlightToken=null;}
  }
  function selectCity(){
    cityKey=Object.hasOwn(CITIES,selector.value)?selector.value:'traversecity';sequence++;current=null;clock();showLoading();
    try{localStorage.setItem('upnorth-goose-city',cityKey);}catch{}
    const city=CITIES[cityKey],cached=city.station&&stationCache.get(city.station);
    if(cached&&observation(cached,city.station)){
      const w=observation(cached,city.station);show(w);
      if(w.description==='Current conditions')fallback(sequence,false);
      return;
    }
    const token=sequence;
    if(!city.station)fallback(token,true);
    else setTimeout(()=>{if(token===sequence&&!current)fallback(token,false);},7000);
  }
  root.addEventListener('goose:nws-station',event=>{
    const station=event.detail?.station,p=event.detail?.observation;if(!station||!p)return;
    stationCache.set(station,p);
    if(CITIES[cityKey].station!==station)return;
    const w=observation(p,station);
    if(w){show(w);if(w.description==='Current conditions')fallback(sequence,false);}
    else if(!fresh(current)){current=null;fallback(sequence,false);}
  });
  root.addEventListener('goose:nws-station-error',event=>{
    if(CITIES[cityKey].station===event.detail?.station&&!fresh(current)){current=null;fallback(sequence,false);}
  });
  selector.addEventListener('change',selectCity);
  selectCity();setInterval(clock,1000);
  setInterval(()=>{if(!CITIES[cityKey].station||current?.kind==='forecast'||!fresh(current))fallback(sequence,!CITIES[cityKey].station);},15*60*1000);
})(typeof window!=='undefined'?window:globalThis);
