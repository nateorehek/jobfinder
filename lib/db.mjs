import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { demoJobs } from '../public/demo.js';
import { fields } from '../public/fields.js';
import { miles, zipPoint } from './geo.mjs';

const sourceExpiry = '-7 days';
const activeLive = "j.source <> 'Example listing' AND j.missing < 2 AND j.last_seen >= datetime('now', ?)";
const utc = value => new Date(value).toISOString().replace('T',' ').slice(0,19);
export const stamp = () => utc(Date.now());
export const iso = value => value ? value.replace(' ','T') + 'Z' : null;
const pageSize = 20;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path),{recursive:true});
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.function('miles',{deterministic:true},miles);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT NOT NULL UNIQUE, canonical_url TEXT UNIQUE, url TEXT, source TEXT NOT NULL, source_id TEXT NOT NULL,
      title TEXT NOT NULL, company TEXT NOT NULL, location TEXT NOT NULL, mode TEXT NOT NULL, kind TEXT NOT NULL,
      summary TEXT NOT NULL, skills TEXT NOT NULL, added TEXT NOT NULL, published TEXT,
      missing INTEGER NOT NULL DEFAULT 0, last_seen TEXT NOT NULL, popularity INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS jobs_added ON jobs(added DESC, id);
    CREATE INDEX IF NOT EXISTS jobs_source ON jobs(source_id, missing);
    CREATE VIRTUAL TABLE IF NOT EXISTS jobs_fts USING fts5(title, company, location, summary, skills, content='jobs', content_rowid='rowid');
    CREATE TRIGGER IF NOT EXISTS jobs_fts_insert AFTER INSERT ON jobs BEGIN
      INSERT INTO jobs_fts(rowid,title,company,location,summary,skills)
      VALUES(new.rowid,new.title,new.company,new.location,new.summary,new.skills);
    END;
    CREATE TRIGGER IF NOT EXISTS jobs_fts_update AFTER UPDATE OF title, company, location, summary, skills ON jobs
    WHEN old.title<>new.title OR old.company<>new.company OR old.location<>new.location OR old.summary<>new.summary OR old.skills<>new.skills BEGIN
      INSERT INTO jobs_fts(jobs_fts,rowid,title,company,location,summary,skills)
      VALUES('delete',old.rowid,old.title,old.company,old.location,old.summary,old.skills);
      INSERT INTO jobs_fts(rowid,title,company,location,summary,skills)
      VALUES(new.rowid,new.title,new.company,new.location,new.summary,new.skills);
    END;
    CREATE TABLE IF NOT EXISTS job_fields (
      job_id TEXT NOT NULL REFERENCES jobs(id), field TEXT NOT NULL, PRIMARY KEY(job_id,field)
    );
    CREATE INDEX IF NOT EXISTS job_fields_filter ON job_fields(field,job_id);
    CREATE TABLE IF NOT EXISTS job_locations (
      job_id TEXT NOT NULL REFERENCES jobs(id), lat REAL NOT NULL, lon REAL NOT NULL, PRIMARY KEY(job_id,lat,lon)
    );
    CREATE INDEX IF NOT EXISTS locations_lat ON job_locations(lat,lon,job_id);
    CREATE TABLE IF NOT EXISTS saved (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, job_id TEXT NOT NULL REFERENCES jobs(id),
      saved_at INTEGER NOT NULL, PRIMARY KEY(user_id,job_id)
    );
    CREATE INDEX IF NOT EXISTS saved_job ON saved(job_id);
    CREATE TABLE IF NOT EXISTS source_runs (
      id TEXT PRIMARY KEY, checked TEXT NOT NULL, success TEXT, count INTEGER, error TEXT
    );
  `);
  if (!db.prepare("SELECT 1 FROM jobs WHERE source_id = 'example' LIMIT 1").get()) {
    transaction(db, () => {
      for (const job of demoJobs) {
        db.prepare(`INSERT OR IGNORE INTO jobs(id,source,source_id,title,company,location,mode,kind,summary,skills,added,last_seen)
          VALUES(?,?,'example',?,?,?,?,?,?,?,?,?)`).run(job.id,job.source,job.title,job.company,job.location,job.mode,job.kind,job.summary,JSON.stringify(job.skills),utc(job.added),stamp());
        for (const field of job.fields) db.prepare('INSERT OR IGNORE INTO job_fields VALUES(?,?)').run(job.id,field);
        if (job.lat != null) db.prepare('INSERT OR IGNORE INTO job_locations VALUES(?,?,?)').run(job.id,job.lat,job.lon);
      }
    });
  }
  return db;
}
export function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function jobView(row) {
  return {
    id:row.id, title:row.title, company:row.company, location:row.location, mode:row.mode,
    kind:row.kind, summary:row.summary, skills:JSON.parse(row.skills), added:iso(row.added),
    published:iso(row.published), url:row.url, source:row.source, popularity:row.popularity,
    active:Boolean(row.active ?? true), distance:row.distance ?? null,
  };
}
export function savedJobs(db,user) {
  return db.prepare(`SELECT j.*, (j.source_id = 'example' OR (${activeLive})) AS active
    FROM saved s JOIN jobs j ON j.id=s.job_id WHERE s.user_id=? ORDER BY s.saved_at DESC,j.id`)
    .all(sourceExpiry,user).map(jobView);
}
export function searchJobs(db, params) {
  const field = params.get('field');
  const kind = params.get('kind');
  const zip = params.get('zip');
  const radius = Number(params.get('radius') ?? 25);
  const sort = params.get('sort') ?? 'recent';
  const offset = Number(params.get('offset') ?? 0);
  const remote = params.get('remote') === 'true';
  const includeRemote = params.get('includeRemote') === 'true';
  const q = (params.get('q') ?? '').trim().slice(0,100);
  if ((field && !fields.some(f => f.id === field)) || (kind && !['job','intern'].includes(kind))
    || !['recent','popular'].includes(sort) || ![10,25,50,100,250].includes(radius)
    || !Number.isSafeInteger(offset) || offset < 0 || offset > 10000) {
    return {error:'Invalid search filters.'};
  }
  const center = zip && zipPoint(zip);
  if (zip && !center) return {error:'Enter a valid 5-digit US ZIP code.'};
  const freshness = iso(db.prepare('SELECT max(success) AS time FROM source_runs').get().time);
  const demo = !freshness;
  const conditions = [demo ? "j.source_id='example'" : activeLive];
  const values = demo ? [] : [sourceExpiry];
  const prefix = [];
  let distance = 'NULL';
  if (q) {
    const tokens = q.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (!tokens.length) return {jobs:[],total:0,next:null,freshness,demo};
    conditions.push('j.rowid IN (SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH ?)');
    values.push(tokens.slice(0,12).map(word => '"' + word + '"*').join(' AND '));
  }
  if (kind) { conditions.push('j.kind=?'); values.push(kind); }
  if (field) {
    conditions.push('EXISTS (SELECT 1 FROM job_fields f WHERE f.field=? AND f.job_id=j.id)');
    values.push(field);
  }
  if (remote) conditions.push("j.mode='Remote'");
  if (center && !remote) {
    const [lat,lon] = center;
    const delta = radius / 68;
    prefix.push(`nearby AS (
      SELECT job_id,min(miles(?,?,lat,lon)) AS distance FROM job_locations
      WHERE lat BETWEEN ? AND ? GROUP BY job_id HAVING distance <= ?
    )`);
    conditions.push(includeRemote ? "(n.distance IS NOT NULL OR j.mode='Remote')" : "(n.distance IS NOT NULL AND j.mode<>'Remote')");
    values.unshift(lat,lon,lat-delta,lat+delta,radius);
    distance = "CASE WHEN j.mode='Remote' THEN NULL ELSE n.distance END";
  }
  const common = (prefix.length ? 'WITH ' + prefix.join(',') + ' ' : '') + 'SELECT ';
  const from = ' FROM jobs j ' + (prefix.length ? 'LEFT JOIN nearby n ON n.job_id=j.id ' : '') + 'WHERE ' + conditions.join(' AND ');
  const total = db.prepare(common + 'count(*) AS count' + from).get(...values).count;
  const ranking = sort === 'popular' ? 'j.popularity + (SELECT count(*) FROM saved s WHERE s.job_id=j.id) DESC, ' : '';
  const jobs = db.prepare(common + 'j.*, ' + distance + ' AS distance' + from + ' ORDER BY ' + ranking + 'j.added DESC,j.id LIMIT ? OFFSET ?')
    .all(...values,pageSize,offset).map(jobView);
  return {jobs,total,next:offset+pageSize<total && offset+pageSize<=10000 ? offset+pageSize:null,freshness,demo};
}

