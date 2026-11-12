import { fetchBoard, blueskyScores } from './sources.mjs';
import { iso, stamp, transaction } from './db.mjs';

const cooldown = 10 * 60 * 1000;
const socialCooldown = 60 * 60 * 1000;

export function recordBoard(db,source,jobs,time = stamp()) {
  transaction(db,()=>{
    const existing = db.prepare('SELECT job_id FROM job_sources WHERE source_id=? AND missing<2').all(source.id);
    const seen = new Set();
    const upsert = db.prepare(`INSERT INTO jobs(id,canonical_url,url,source,source_id,title,company,location,mode,kind,summary,skills,added,published,last_seen)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(canonical_url) DO UPDATE SET
      url=excluded.url, title=excluded.title, location=excluded.location, mode=excluded.mode, kind=excluded.kind,
      summary=excluded.summary, skills=excluded.skills, published=COALESCE(excluded.published,jobs.published),
      source=excluded.source, source_id=excluded.source_id, company=excluded.company, missing=0, last_seen=excluded.last_seen
      WHERE ? OR jobs.source_id=excluded.source_id
      RETURNING id`);
    const findJob = db.prepare('SELECT id FROM jobs WHERE canonical_url=?');
    const employerFeed = source.provider !== 'simplifyjobs';
    const seenSource = db.prepare(`INSERT INTO job_sources(job_id,source_id,last_seen) VALUES(?,?,?)
      ON CONFLICT(job_id,source_id) DO UPDATE SET missing=0,last_seen=excluded.last_seen`);
    const clearFields = db.prepare('DELETE FROM job_fields WHERE job_id=?');
    const clearLocations = db.prepare('DELETE FROM job_locations WHERE job_id=?');
    const addField = db.prepare('INSERT INTO job_fields VALUES(?,?)');
    const addLocation = db.prepare('INSERT INTO job_locations VALUES(?,?,?)');
    for (const job of jobs) {
      const row = upsert.get(job.id,job.canonical,job.url,job.source,job.sourceId,job.title,job.company,job.location,job.mode,job.kind,
        job.summary,JSON.stringify(job.skills),time,job.published,time,Number(employerFeed));
      const id = row?.id ?? findJob.get(job.canonical).id;
      seen.add(id);
      seenSource.run(id,source.id,time);
      if (!row) continue;
      clearFields.run(row.id);
      clearLocations.run(row.id);
      for (const field of job.fields) addField.run(row.id,field);
      for (const point of job.points) addLocation.run(row.id,...point);
    }
    const missing = db.prepare('UPDATE job_sources SET missing=missing+1 WHERE job_id=? AND source_id=?');
    for (const row of existing) if (!seen.has(row.job_id)) missing.run(row.job_id,source.id);
    db.prepare(`INSERT INTO source_runs VALUES(?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET
      checked=excluded.checked,success=excluded.success,count=excluded.count,error=NULL`).run(source.id,time,time,seen.size);
  });
}
function recordError(db,sourceId,error) {
  const message = String(error?.message || error).slice(0,240);
  console.warn('Feed refresh failed',sourceId,message);
  db.prepare(`INSERT INTO source_runs(id,checked,error) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET
    checked=excluded.checked,error=excluded.error`).run(sourceId,stamp(),message);
}
async function batches(items,concurrency,callback) {
  for (let i=0;i<items.length;i+=concurrency) await Promise.all(items.slice(i,i+concurrency).map(callback));
}
export function createRefresh(db,boards,{social=true,fetcher=fetch,interval=30} = {}) {
  let running = null;
  let lastSocial = 0;
  const byId = db.prepare('SELECT checked,success,error FROM source_runs WHERE id=?');
  const byScope = field => boards.filter(source=>!field || !source.fields.length || source.fields.includes(field));
  const status = field => {
    const scoped = byScope(field);
    const runs = scoped.map(source=>byId.get(source.id)).filter(Boolean);
    const successful = runs.map(run=>run.success).filter(Boolean).sort();
    return {
      running:Boolean(running), boards:scoped.length, failed:runs.filter(run=>run.error).length,
      freshness:iso(successful.at(-1)),
    };
  };
  const start = (field = '', force = false) => {
    if (running) return { state:'running', promise:running };
    const scoped = byScope(field);
    const eligible = scoped.filter(source=>{
      const checked = byId.get(source.id)?.checked;
      return force || !checked || Date.now()-Date.parse(iso(checked))>=cooldown;
    });
    if (!eligible.length) return {state:scoped.length?'recent':'disabled'};
    running = (async()=>{
      await batches(eligible,4,async source=>{
        try { recordBoard(db,source,await fetchBoard(source,fetcher)); }
        catch (error) { recordError(db,source.id,error); }
      });
      if (social && Date.now()-lastSocial>=socialCooldown) {
        lastSocial = Date.now();
        try {
          const scores = await blueskyScores(fetcher);
          transaction(db,()=>{
            db.exec('UPDATE jobs SET popularity=0 WHERE popularity<>0');
            const update = db.prepare('UPDATE jobs SET popularity=? WHERE canonical_url=?');
            for (const [url,score] of scores) if (score>0) update.run(score,url);
          });
        } catch (error) { console.warn(error.message); }
      }
    })().finally(()=>{ running=null; });
    return {state:'started',promise:running};
  };
  function schedule() {
    if (!boards.length || interval<=0) return () => {};
    const run = () => start().promise?.catch(error=>console.error(error));
    run();
    const timer = setInterval(run,Math.max(10,interval)*60_000);
    timer.unref();
    return () => clearInterval(timer);
  }
  return {start,status,schedule};
}

