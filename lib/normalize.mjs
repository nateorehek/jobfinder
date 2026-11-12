import { createHash } from 'node:crypto';
import { fields } from '../public/fields.js';
import { cityPoint } from './geo.mjs';

const entities = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',ndash:'–',mdash:'—',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',bull:'•'};
function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(raw,key) => {
    if (key[0] !== '#') return entities[key.toLowerCase()] ?? raw;
    const hex = key[1].toLowerCase() === 'x';
    const code = Number.parseInt(key.slice(hex ? 2 : 1),hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : raw;
  });
}
function blocks(text) {
  return decode(decode(String(text ?? '').slice(0,100000))
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,' ')
    .replace(/<\/?(?:p|div|li|br|h[1-6]|ul|ol)\b[^>]*>/gi,'\n').replace(/<[^>]+>/g,' '))
    .split(/\r?\n/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
}
function shorten(value,max) {
  if (value.length<=max) return value;
  const head = value.slice(0,max);
  const last = head.lastIndexOf(' ');
  return head.slice(0,last > max/2 ? last : max) + '…';
}
function summarize(text) {
  const header = text.findIndex(line => /^(?:about (?:the |this )?role|the role|job summary|your (?:role|impact)|(?:role|job) overview|what you(?:’|')?ll (?:do|work on)|(?:key |primary )?responsibilities|in this role(?:, you (?:will|could potentially work on))?)\W*$/i.test(line));
  const body = header >= 0 ? text.slice(header+1) : text;
  const isHeader = line => /(?:\.{3}|:)$/.test(line) || /^(?:in this role|what you|about the role)\b/i.test(line) && line.length<75;
  const informative = body.find(line=>/^(?:you(?:'|’)ll|in this role|we are looking for|we(?:'|’)re looking for|as an? |build\b|develop\b|assist\b|support\b|coordinate\b|manage\b|work\b|conduct\b|design\b|analyze\b)/i.test(line) && line.length>=34 && !isHeader(line));
  const first = header >= 0 ? body.find(line=>line.length>=40 && !isHeader(line)) : informative;
  const fallback = body.find(line=>line.length>=70 && !isHeader(line) && !/^(?:equal opportunity|by applying|about us|location:|please note)/i.test(line));
  if (!first && !fallback) return 'See the employer posting for responsibilities and qualifications.';
  const chosen = first || fallback;
  const sentences = chosen.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
  return shorten(sentences?.slice(0,2).join('').trim() || chosen,460);
}
const skills = [
  ['TypeScript',/\btypescript\b/i],['JavaScript',/\bjavascript\b/i],['React',/\breact(?:\.js| native)?\b/i],
  ['Python',/\bpython\b/i],['SQL',/\bsql\b/i],['Java',/\bjava\b/i],['C++',/\bC\+\+/],['C#',/\bC#/],
  ['Git',/\bgit\b/i],['AWS',/\baws\b/i],['Azure',/\bazure\b/i],['Google Cloud',/\b(?:gcp|google cloud)\b/i],
  ['Docker',/\bdocker\b/i],['Kubernetes',/\bkubernetes\b/i],['Linux',/\blinux\b/i],['REST APIs',/\brest(?:ful)? api/i],
  ['Excel',/\bExcel\b/],['Financial modeling',/\bfinancial model/i],['Accounting',/\baccounting\b/i],
  ['Tableau',/\btableau\b/i],['Power BI',/\bpower bi\b/i],['Data visualization',/\bdata visuali[sz]ation/i],
  ['Machine learning',/\bmachine learning\b/i],['Statistics',/\bstatistic(?:s|al analysis)\b/i],
  ['Figma',/\bfigma\b/i],['User research',/\b(?:user|usability) research\b/i],['Prototyping',/\bprototyp(?:e|ing)\b/i],
  ['CAD',/\b(?:CAD|SolidWorks|AutoCAD)\b/i],['MATLAB',/\bmatlab\b/i],['Laboratory techniques',/\b(?:laboratory techniques|wet lab|cell culture|pipetting)\b/i],
  ['Clinical research',/\bclinical research\b/i],['Data collection',/\bdata collection\b/i],
  ['Policy analysis',/\bpolicy analysis\b/i],['Copywriting',/\bcopywriting\b/i],['Technical writing',/\btechnical writing\b/i],
  ['Project management',/\bproject management\b/i],['Data analysis',/\bdata analysis\b/i],['Communication',/\bcommunication skills\b/i],
];
export function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    url.hash = '';
    const greenhouse = url.searchParams.get('gh_jid');
    const hostedGreenhouse = /^(?:job-)?boards\.greenhouse\.io$/.test(url.hostname) && url.pathname.match(/\/jobs\/(\d+)\/?$/)?.[1];
    if (greenhouse && /^\d+$/.test(greenhouse)) return 'https://boards.greenhouse.io/jobs/' + greenhouse;
    if (hostedGreenhouse) return 'https://boards.greenhouse.io/jobs/' + hostedGreenhouse;
    if (/^jobs\.(?:eu\.)?(?:lever\.co|ashbyhq\.com)$/.test(url.hostname)) url.pathname = url.pathname.replace(/\/application\/?$/,'');
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gh_src$|lever-source$|source$|ref$|referrer$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/,'') || '/';
    return url.href;
  } catch { return null; }
}
function classify(title,group,description) {
  const weighted = [title,group,description.slice(0,3500)].map(value=>value.toLowerCase());
  const matches = fields.map(f => {
    const [a,b,c] = weighted.map(s=>f.terms.filter(term=>s.includes(term)).length);
    return {id:f.id,score:a*8+b*3+Math.min(4,c)};
  }).sort((a,b)=>b.score-a.score);
  const threshold = matches[0].score >= 8 ? 8 : 3;
  return matches.filter(f=>f.score>=threshold).slice(0,3).map(f=>f.id);
}
function workplace(job) {
  const primary = [job.workplace,job.title,...job.locations].join(' ');
  if (/\bhybrid\b/i.test(primary)) return 'Hybrid';
  if (job.remote || /\bremote\b/i.test(primary)) return 'Remote';
  if (/\bon[ -]?site\b|\bin.office\b/i.test(primary)) return 'On-site';
  return 'Unspecified';
}
export function normalizeJob(job,source) {
  const title = shorten(blocks(job.title).join(' '),200);
  const canonical = canonicalUrl(job.url);
  if (!title || !canonical) return null;
  const kind = /\b(?:intern(?:ship)?s?|co[ -]?op|student (?:trainee|worker))\b/i.test(title+' '+job.kind) && !/\bformer interns?\b/i.test(title) ? 'intern' : 'job';
  if (kind === 'job' && /^(?:sr\.?|senior|staff|principal|director|head of|[es]?vp|vice president|lead|chief)\b|\b(?:director|vice president|team lead|senior manager|staff engineer|senior engineer|engineering manager)\b/i.test(title)) return null;
  const text = blocks(job.description);
  const description = text.join('\n');
  const group = String(job.group ?? '');
  const matchedFields = classify(title,group,description);
  if (!matchedFields.length && source.fields.length === 1) matchedFields.push(...source.fields);
  const locs = [...new Set(job.locations.map(x=>blocks(x).join(' ')).filter(Boolean))];
  const pointCandidates = [...locs,...(job.geocodeLocations ?? [])]
    .flatMap(loc=>loc.split(/\s*(?:;|\||\/|•)\s*|\s+or\s+(?=[^,;|/•]+,)/));
  const points = pointCandidates.map(loc=>cityPoint(loc
    .replace(/^(?:hybrid|on[ -]?site)\s*[-–:]\s*/i,'')
    .replace(/\s*\((?:hybrid|on[ -]?site)\)\s*$/i,''))).filter(Boolean);
  const uniquePoints = [...new Map(points.map(p=>[p.join(','),p])).values()];
  const mode = workplace({...job,locations:locs});
  const usedSkills = skills.filter(([,pattern])=>pattern.test(title+' '+description)).map(([label])=>label).slice(0,8);
  const published = Date.parse(job.published);
  return {
    id:createHash('sha256').update(canonical).digest('hex').slice(0,28), canonical, url:new URL(job.url).href,
    source:source.provider[0].toUpperCase()+source.provider.slice(1), sourceId:source.id,
    title,company:source.company,location:shorten(locs.join(' · '),320),kind,mode,summary:summarize(text),
    fields:matchedFields,skills:usedSkills,points:uniquePoints,published:Number.isFinite(published) ? new Date(published).toISOString().replace('T',' ').slice(0,19) : null,
  };
}

