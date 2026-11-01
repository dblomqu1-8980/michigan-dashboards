const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const siteRoot=path.join(__dirname,'..','sites','906');
const {CITIES,fahrenheit,mph,look,timeInZone,isDaylight,observation}=require(path.join(siteRoot,'yooper-buddy','hero.js'));

test('outfits reflect rain, snow, cold and wind in the right order',()=>{
  assert.equal(look({temperature:70,description:'Sunny',windMph:5}).outfit,'summer');
  assert.equal(look({temperature:56,description:'Rain showers',windMph:20}).outfit,'rain');
  assert.equal(look({temperature:25,description:'Snow showers',windMph:20}).scene,'snow');
  assert.equal(look({temperature:20,description:'Windy',windMph:22}).outfit,'winter');
  assert.equal(look({temperature:55,description:'Cloudy',windMph:5}).outfit,'wind');
  assert.equal(look({temperature:65,description:'Windy',windMph:23}).scene,'wind');
});
test('NWS units and missing values are handled without fabricating zeroes',()=>{
  assert.equal(fahrenheit(0,'wmoUnit:degC'),32);
  assert.equal(fahrenheit(55,'F'),55);
  assert.equal(fahrenheit(null),null);
  assert.equal(mph(16.0934,'wmoUnit:km_h'),10);
  assert.equal(mph(10,'wmoUnit:m_s'),22);
  assert.equal(mph(10,'wmoUnit:mi_h'),10);
  assert.equal(mph(null),null);
});
test('Eastern and Central locations use the right local clock',()=>{
  const date=new Date('2026-11-01T18:00:00Z');
  assert.equal(timeInZone(CITIES.marquette.zone,date),'1:00:00 PM');
  assert.equal(timeInZone(CITIES.ironwood.zone,date),'12:00:00 PM');
});
test('the scene follows approximate local daylight in summer and winter',()=>{
  assert.equal(isDaylight(CITIES.marquette,new Date('2026-12-20T23:00:00Z')),false);
  assert.equal(isDaylight(CITIES.marquette,new Date('2026-06-21T23:00:00Z')),true);
  assert.equal(isDaylight(CITIES.marquette,new Date('2026-06-21T07:00:00Z')),false);
});
test('observations must contain a fresh timestamp and temperature',()=>{
  const now=Date.parse('2026-11-01T18:00:00Z');
  const base={timestamp:'2026-11-01T17:30:00Z',temperature:{value:0,unitCode:'wmoUnit:degC'},windSpeed:{value:16.0934,unitCode:'wmoUnit:km_h'},textDescription:'Cloudy'};
  const result=observation(base,'KSAW',now);
  assert.equal(result.temperature,32);assert.equal(result.windMph,10);assert.equal(result.station,'KSAW');
  assert.equal(observation({...base,timestamp:'2026-11-01T14:00:00Z'},'KSAW',now),null);
  assert.equal(observation({...base,temperature:{value:null}},'KSAW',now),null);
});

test('the existing dashboard converts the actual NWS wind units',()=>{
  const fs=require('node:fs');const vm=require('node:vm');
  const html=fs.readFileSync(path.join(siteRoot,'index.html'),'utf8');
  const match=html.match(/function nwsWindToMph\(measurement\) \{[\s\S]*?\n\}/);
  assert.ok(match,'dashboard converter is present');
  const convert=vm.runInNewContext('('+match[0]+')');
  assert.equal(convert({value:16.0934,unitCode:'wmoUnit:km_h'}),10);
  assert.equal(convert({value:10,unitCode:'wmoUnit:m_s'}),22);
  assert.equal(convert({value:10,unitCode:'wmoUnit:mi_h'}),10);
  assert.equal(convert({value:10,unitCode:'wmoUnit:kn'}),12);
  assert.equal(convert({value:10,unitCode:'unknown'}),null);
  assert.equal(convert({value:null,unitCode:'wmoUnit:km_h'}),null);
});
