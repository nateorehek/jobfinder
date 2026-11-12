import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb,searchJobs,stamp } from '../lib/db.mjs';
import { normalizeJob } from '../lib/normalize.mjs';
import { createRefresh,recordBoard } from '../lib/refresh.mjs';
import { blueskyScores } from '../lib/sources.mjs';
import { makeServer } from '../server.mjs';

const source = {id:'greenhouse:exampleco',provider:'greenhouse',board:'exampleco',company:'Example Co',fields:['cs']};
const secondSource = {...source,id:'greenhouse:second',board:'second'};
const raw = {
  title:'Software Engineer Intern',url:'https://job-boards.greenhouse.io/exampleco/jobs/123?utm_source=test',
  description:'<p>About the role</p><p>Develop React components for the customer dashboard and build reliable tests in TypeScript.</p>',
  locations:['New York, NY','Boston, MA'],kind:'intern',
};

test('deduplicates source URLs, filters on any office, and preserves bookmarks when a role closes',()=>{
  const db = openDb(':memory:');
  try {
    const job = normalizeJob(raw,source);
    assert.equal(job.canonical,'https://boards.greenhouse.io/jobs/123');
    assert.deepEqual(job.skills,['TypeScript','React']);
    assert.match(job.summary,/Develop React components/);
    recordBoard(db,source,[job]);
    const originalTime = stamp();
    recordBoard(db,secondSource,[normalizeJob({...raw,url:'https://example.com/careers?gh_jid=123'},secondSource)]);
    const search = q => searchJobs(db,new URLSearchParams(q));
    const newYork = search('q=software+react&field=cs&kind=intern&zip=10001&radius=10');
    assert.equal(newYork.total,1);
    assert.equal(newYork.jobs[0].id,job.id);
    assert.ok(newYork.jobs[0].distance<10);
    assert.equal(search('zip=02108&radius=10').total,1);
    assert.equal(search('zip=60601&radius=10').total,0);
    assert.equal(search('field=science').total,0);
    db.prepare("INSERT INTO users VALUES (1,'user@example.com','fixture')").run();
    db.prepare('INSERT INTO saved VALUES(1,?,?)').run(job.id,Date.now());
    recordBoard(db,source,[],originalTime);
    recordBoard(db,source,[],originalTime);
    assert.equal(search('').total,1);
    recordBoard(db,secondSource,[],originalTime);
    assert.equal(search('').total,1);
    recordBoard(db,secondSource,[],originalTime);
    assert.equal(search('').total,0);
    assert.equal(db.prepare('SELECT count(*) AS count FROM saved').get().count,1);
  } finally { db.close(); }
});

test('ZIP search recognizes offices listed as alternatives and preserves the Oregon state code',()=>{
  const db = openDb(':memory:');
  try {
    const job = normalizeJob({...raw,locations:['Portland, OR or Charlotte, NC (Hybrid)']},source);
    assert.equal(job.points.length,2);
    recordBoard(db,source,[job]);
    for (const zip of ['28202','97201']) {
      const result = searchJobs(db,new URLSearchParams({zip,radius:'25'}));
      assert.equal(result.total,1);
      assert.equal(result.jobs[0].id,job.id);
    }
  } finally { db.close(); }
});

test('failed refresh preserves listings and only checks boards mapped to the requested field', async ()=>{
  const db = openDb(':memory:');
  try {
    recordBoard(db,source,[normalizeJob(raw,source)]);
    const science = {...secondSource,fields:['science']};
    let calls = 0;
    const refresh = createRefresh(db,[source,science],{social:false,fetcher:async ()=>{
      calls++;
      return new Response(null,{status:503});
    }});
    await refresh.start('cs',true).promise;
    assert.equal(calls,1);
    assert.equal(refresh.status('cs').failed,1);
    assert.equal(refresh.status('science').failed,0);
    assert.equal(refresh.start('cs').state,'recent');
    assert.equal(searchJobs(db,new URLSearchParams()).total,1);
  } finally { db.close(); }
});

test('Bluesky scores only linked postings and deduplicates posts across searches',async ()=>{
  const data = {posts:[{uri:'at://fixture',likeCount:4,repostCount:2,record:{createdAt:new Date().toISOString(),facets:[{features:[{uri:raw.url}]}]},embed:{external:{uri:raw.url}}}]};
  const scores = await blueskyScores(async ()=>Response.json(data));
  assert.deepEqual([...scores],[['https://boards.greenhouse.io/jobs/123',6]]);
});

test('sessions and saved roles are isolated across accounts',async t=>{
  const db = openDb(':memory:');
  const server = makeServer(db);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{ await new Promise(resolve=>server.close(resolve)); db.close(); });
  const request = (path, options) => fetch('http://127.0.0.1:'+server.address().port+'/api'+path,options);
  const password = 'Fixture password 2026';
  const authenticate = (path,email) => request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const first = await authenticate('/register','first@example.com');
  const second = await authenticate('/register','second@example.com');
  assert.equal(first.status,201);
  assert.equal(second.status,201);
  const a = {cookie:first.headers.get('set-cookie').split(';')[0]};
  const b = {cookie:second.headers.get('set-cookie').split(';')[0]};
  assert.equal((await request('/saved/demo-0',{method:'PUT'})).status,401);
  assert.equal((await request('/saved/demo-0',{method:'PUT',headers:{...a,origin:'https://invalid.example'}})).status,403);
  assert.equal((await request('/saved/demo-0',{method:'PUT',headers:a})).status,200);
  assert.equal((await (await request('/saved',{headers:a})).json()).jobs.length,1);
  assert.equal((await (await request('/saved',{headers:b})).json()).jobs.length,0);
  assert.equal((await request('/logout',{method:'POST',headers:a})).status,200);
  assert.equal((await request('/saved',{headers:a})).status,401);
  const login = await authenticate('/login','first@example.com');
  assert.equal(login.status,200);
  const restored = {cookie:login.headers.get('set-cookie').split(';')[0]};
  assert.equal((await (await request('/saved',{headers:restored})).json()).jobs.length,1);
});

