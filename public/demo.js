const now = Date.now();
const samples = [
  ['Software Engineering Intern','Northstar Labs','New York, NY','Hybrid','intern',['cs'],['TypeScript','React','Git'],'Build and test features for a web product alongside a small engineering team. You’ll review code, work with designers, and ship improvements to the customer dashboard.',40.7128,-74.006],
  ['Data Analyst, New Grad','Civic Metrics','Boston, MA','On-site','job',['data'],['SQL','Python','Data visualization'],'Analyze program outcomes, maintain reporting dashboards, and help partner teams interpret trends in operational data.',42.3601,-71.0589],
  ['Product Design Intern','Form & Field','Remote · US','Remote','intern',['design'],['Figma','Prototyping','User research'],'Explore customer needs, prototype interface improvements, and share your design decisions with a cross-functional product team.',null,null],
  ['Mechanical Engineering Intern','Atlas Robotics','Pittsburgh, PA','On-site','intern',['engineering'],['CAD','Prototyping','Testing'],'Support mechanical design, prototype components, and run bench tests for a small robotics team.',40.4406,-79.9959],
  ['Finance Rotational Associate','Cedar Capital','Chicago, IL','Hybrid','job',['business'],['Excel','Financial modeling','Reporting'],'Rotate through planning, accounting, and operations while preparing forecasts and monthly performance reports.',41.8781,-87.6298],
  ['Clinical Research Assistant','Harbor Health','Baltimore, MD','On-site','job',['science'],['Data collection','Documentation','Research'],'Coordinate study records, prepare participant materials, and help the research team track study milestones.',39.2904,-76.6122],
  ['Public Policy Intern','Common Ground Institute','Washington, DC','Hybrid','intern',['social'],['Research','Writing','Excel'],'Research local policy, summarize public data, and draft briefing materials for program staff.',38.9072,-77.0369],
  ['Junior Security Engineer','Meridian Systems','Remote · US','Remote','job',['cs'],['Linux','Python','Networking'],'Help investigate security alerts, maintain internal monitoring, and document incident response procedures.',null,null],
];
export const demoJobs = samples.map(([title,company,location,mode,kind,fields,skills,summary,lat,lon],i) => ({
  id: 'demo-' + i, title, company, location, mode, kind, fields, skills, summary, lat, lon,
  added: new Date(now - (i + 1) * 86400000).toISOString(), source: 'Example listing', popularity: 0, active: true, url: null,
}));
const zipPoints = {
  '10001':[40.7506,-73.9972], '02108':[42.357,-71.064], '60601':[41.886,-87.618],
  '15222':[40.449,-79.992], '21201':[39.295,-76.621], '20001':[38.91,-77.017],
};
export function demoSearch(p) {
  const center = p.zip && zipPoints[p.zip];
  if (p.zip && !center) throw new Error('Try 10001, 02108, 60601, 15222, 21201, or 20001 in the example catalog.');
  const jobs = demoJobs.flatMap(job => {
    const searchable = [job.title,job.company,job.location,...job.skills,job.summary].join(' ').toLowerCase();
    if (p.q && !p.q.toLowerCase().split(/\s+/).every(word => searchable.includes(word))) return [];
    if (p.field && !job.fields.includes(p.field)) return [];
    if (p.kind && job.kind !== p.kind) return [];
    if (p.remote && job.mode !== 'Remote') return [];
    const distance = center && job.lat != null ? miles(center, [job.lat, job.lon]) : null;
    if (center && !(job.mode === 'Remote' ? p.includeRemote || p.remote : distance != null && distance <= p.radius)) return [];
    return [{ ...job, distance: job.mode === 'Remote' ? null : distance }];
  });
  return { jobs, total: jobs.length, next: null, demo: true };
}
export function miles(a,b) {
  const rad = Math.PI / 180;
  const sin = Math.sin((b[0]-a[0])*rad/2)**2 + Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin((b[1]-a[1])*rad/2)**2;
  return 3958.76 * 2 * Math.asin(Math.min(1,Math.sqrt(sin)));
}
