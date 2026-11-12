import { readFileSync } from 'node:fs';
import { fields } from '../public/fields.js';
import { canonicalUrl, normalizeJob } from './normalize.mjs';

const roots = {
  greenhouse: board => 'https://boards-api.greenhouse.io/v1/boards/'+board+'/jobs?content=true',
  lever: board => 'https://api.lever.co/v0/postings/'+board+'?mode=json',
  ashby: board => 'https://api.ashbyhq.com/posting-api/job-board/'+board,
  simplifyjobs: () => 'https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json',
};
const internshipFields = new Map([
  ['Software',['cs']], ['Software Engineering',['cs']], ['AI/ML/Data',['data']],
  ['Quant',['data','business']], ['Hardware',['engineering']], ['Product',['business']],
]);
export function loadBoards(path = new URL('../config/boards.json',import.meta.url)) {
  const entries = JSON.parse(readFileSync(path,'utf8'));
  const ids = new Set();
  if (!Array.isArray(entries) || entries.length>100) throw new Error('Boards must be an array of up to 100 sources.');
  return entries.map(entry=>{
    const {provider,board,company,fields:groups} = entry;
    const id = provider+':'+board;
    if (!Object.hasOwn(roots,provider) || typeof board !== 'string' || !/^[a-z0-9_.-]{1,80}$/i.test(board)
      || (provider === 'simplifyjobs' && board !== 'summer2027')
      || typeof company !== 'string' || !company.trim() || company.length>100 || !Array.isArray(groups)
      || groups.some(group=>!fields.some(field=>field.id===group)) || ids.has(id)) throw new Error('Invalid or duplicate board: '+id);
    ids.add(id);
    return {provider,board,company,fields:groups,id};
  });
}
async function getJson(url,fetcher,{plainText=false} = {}) {
  const response = await fetcher(url,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'},redirect:'error'});
  if (!response.ok) throw new Error('Upstream HTTP '+response.status);
  const content = response.headers.get('content-type') || '';
  if (!content.includes('json') && !(plainText && content.startsWith('text/plain'))) {
    throw new Error('Upstream response is not JSON');
  }
  return response.json();
}
export async function fetchBoard(source,fetcher = fetch) {
  if (source.provider === 'simplifyjobs') {
    return simplifyInternships(await getJson(roots.simplifyjobs(),fetcher,{plainText:true}),source);
  }
  const payload = await getJson(roots[source.provider](source.board),fetcher);
  const raw = source.provider === 'lever' ? payload : payload?.jobs;
  if (!Array.isArray(raw)) throw new Error('Job array missing from upstream response');
  const jobs = raw.filter(row => row && row.isListed !== false);
  if (jobs.some(row=>typeof (row.title ?? row.text) !== 'string' ||
    typeof (row.absolute_url ?? row.hostedUrl ?? row.jobUrl ?? row.applyUrl) !== 'string')) {
    throw new Error('Unexpected upstream job schema');
  }
  return jobs.map(row=>normalizeJob(adapt(source.provider,row),source)).filter(Boolean);
}
function simplifyInternships(rows,source) {
  if (!Array.isArray(rows) || !rows.length || rows.some(row =>
    typeof row?.active !== 'boolean' || typeof row.is_visible !== 'boolean' || !Array.isArray(row.terms)
  )) throw new Error('Unexpected SimplifyJobs listing schema');

  return rows.filter(row=>row.active && row.is_visible && row.terms.includes('Summer 2027'))
    .map(row=>{
      if (typeof row.title !== 'string' || typeof row.company_name !== 'string' || !row.company_name.trim()
        || typeof row.url !== 'string' || !Array.isArray(row.locations)) {
        throw new Error('Incomplete SimplifyJobs internship');
      }
      return normalizeJob({
        title:row.title,url:row.url,kind:'internship',locations:row.locations,
        published:row.date_posted > 0 ? new Date(row.date_posted * 1000) : undefined,
        suggestedFields:internshipFields.get(row.category),
      },{...source,company:row.company_name.trim(),label:'SimplifyJobs'});
    }).filter(Boolean);
}
function locationAddress(address) {
  if (!address) return '';
  const {addressLocality, addressRegion, addressCountry} = address;
  return addressLocality && addressRegion ? [addressLocality,addressRegion,addressCountry].filter(Boolean).join(', ') : '';
}
function adapt(provider,row) {
  if (provider === 'greenhouse') return {
    title:row.title,url:row.absolute_url,description:row.content,
    locations:[row.location?.name],kind:row.metadata?.find(m=>/employment type/i.test(m.name))?.value,
    group:row.departments?.map(d=>d.name).join(' '),published:row.first_published,
  };
  if (provider === 'lever') return {
    title:row.text,url:row.hostedUrl,description:[row.descriptionPlain,...(row.lists ?? []).map(l=>l.text+'\n'+l.content)].filter(Boolean).join('\n'),
    locations:[row.categories?.location,...(row.categories?.allLocations ?? [])],kind:row.categories?.commitment,
    group:[row.categories?.team,row.categories?.department].filter(Boolean).join(' '),workplace:row.workplaceType,
  };
  return {
    title:row.title,url:row.jobUrl || row.applyUrl,description:row.descriptionPlain || row.descriptionHtml,
    locations:[row.location,...(row.secondaryLocations ?? []).map(l=>l.location)],kind:row.employmentType,
    geocodeLocations:[locationAddress(row.address?.postalAddress),...(row.secondaryLocations ?? []).map(l=>locationAddress(l.address?.postalAddress ?? l.address))].filter(Boolean),
    group:[row.department,row.team].filter(Boolean).join(' '),workplace:row.workplaceType,remote:row.isRemote,published:row.publishedAt,
  };
}
const socialDomains = ['job-boards.greenhouse.io','boards.greenhouse.io','jobs.lever.co','jobs.ashbyhq.com'];
export async function blueskyScores(fetcher = fetch) {
  const cutoff = Date.now()-30*86400000;
  const results = await Promise.allSettled(socialDomains.map(async domain=>{
    const params = new URLSearchParams({q:'*',domain,limit:'75',sort:'latest'});
    const data = await getJson('https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?'+params,fetcher);
    if (!Array.isArray(data.posts)) throw new Error('Post array missing from Bluesky');
    return data.posts;
  }));
  if (results.some(result=>result.status==='rejected')) {
    throw new Error('Bluesky scan incomplete; retaining previous scores');
  }
  const counts = new Map();
  const seen = new Set();
  for (const post of results.flatMap(result=>result.value)) {
    if (!post.uri || seen.has(post.uri) || !(Date.parse(post.record?.createdAt ?? post.indexedAt)>=cutoff)) continue;
    seen.add(post.uri);
    const links = new Set([post.embed?.external?.uri,post.record?.embed?.external?.uri,
      ...(post.record?.facets ?? []).flatMap(f=>(f.features ?? []).map(feature=>feature.uri)),
    ].map(canonicalUrl).filter(Boolean));
    const signal = (post.likeCount || 0) + (post.repostCount || 0) + (post.replyCount || 0) + (post.quoteCount || 0);
    for (const link of links) counts.set(link,(counts.get(link) ?? 0)+signal);
  }
  return counts;
}

