import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const names = 'Alabama:AL|Alaska:AK|Arizona:AZ|Arkansas:AR|California:CA|Colorado:CO|Connecticut:CT|Delaware:DE|District of Columbia:DC|Florida:FL|Georgia:GA|Hawaii:HI|Idaho:ID|Illinois:IL|Indiana:IN|Iowa:IA|Kansas:KS|Kentucky:KY|Louisiana:LA|Maine:ME|Maryland:MD|Massachusetts:MA|Michigan:MI|Minnesota:MN|Mississippi:MS|Missouri:MO|Montana:MT|Nebraska:NE|Nevada:NV|New Hampshire:NH|New Jersey:NJ|New Mexico:NM|New York:NY|North Carolina:NC|North Dakota:ND|Ohio:OH|Oklahoma:OK|Oregon:OR|Pennsylvania:PA|Rhode Island:RI|South Carolina:SC|South Dakota:SD|Tennessee:TN|Texas:TX|Utah:UT|Vermont:VT|Virginia:VA|Washington:WA|West Virginia:WV|Wisconsin:WI|Wyoming:WY|Puerto Rico:PR'.split('|').map(pair => pair.split(':'));
const states = new Map(names.flatMap(([name, code]) => [[name.toLowerCase(),code],[code.toLowerCase(),code]]));
const normalize = value => value.toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
const zipPoints = new Map();
const cities = new Map();

const data = gunzipSync(readFileSync(new URL('../reference/us-zip.tsv.gz', import.meta.url))).toString();
for (const line of data.split('\n')) {
  const [zip,city,state,lat,lon] = line.split('\t');
  if (!zip || !lat || !lon) continue;
  const point = [Number(lat),Number(lon)];
  if (!zipPoints.has(zip)) zipPoints.set(zip,point);
  const key = normalize(city) + ',' + state;
  const values = cities.get(key) ?? [0,0,0];
  values[0] += point[0];
  values[1] += point[1];
  values[2] += 1;
  cities.set(key,values);
}
const overrides = new Map([
  ['new york,NY',[40.7128,-74.0060]], ['san francisco,CA',[37.7749,-122.4194]],
  ['los angeles,CA',[34.0522,-118.2437]], ['washington,DC',[38.9072,-77.0369]],
]);
export const zipPoint = zip => zipPoints.get(zip);
export function cityPoint(location) {
  const parts = String(location).trim().split(',').map(part => part.trim());
  const [city, region] = parts;
  const state = states.get(region?.toLowerCase().replace(/\s+\d{5}(?:-\d{4})?$/,''));
  if (!state || !city || parts.slice(2).some(p => p && !/^(us|usa|united states(?: of america)?)$/i.test(p))) return null;
  const key = normalize(city.replace(/^\w+:\s*/,'')) + ',' + state;
  if (overrides.has(key)) return overrides.get(key);
  const sums = cities.get(key);
  return sums ? [sums[0]/sums[2],sums[1]/sums[2]] : null;
}
export function miles(lat, lon, otherLat, otherLon) {
  if (lat == null || lon == null || otherLat == null || otherLon == null) return null;
  const rad = Math.PI / 180;
  const sin = Math.sin((otherLat-lat)*rad/2)**2 + Math.cos(lat*rad)*Math.cos(otherLat*rad)*Math.sin((otherLon-lon)*rad/2)**2;
  return 3958.76 * 2 * Math.asin(Math.min(1, Math.sqrt(sin)));
}

