import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { openDb, savedJobs, searchJobs } from './lib/db.mjs';
import { authenticate, getAccount, rateLimiter, signOut } from './lib/auth.mjs';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/demo.js', ['demo.js', 'text/javascript; charset=utf-8']],
  ['/fields.js', ['fields.js', 'text/javascript; charset=utf-8']],
  ['/mark.svg', ['mark.svg', 'image/svg+xml']],
]);
export async function staticFile(req, res, path) {
  const file = files.get(path);
  if (!file || req.method !== 'GET') {
    res.writeHead(404).end('Not found');
    return;
  }
  const data = await readFile(new URL('./public/' + file[0], import.meta.url));
  res.writeHead(200, { 'Content-Type': file[1] }).end(data);
}

function json(res,status,data) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify(data));
}
class HttpError extends Error {
  constructor(status,message) {
    super(message);
    this.status = status;
  }
}
async function jsonBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    throw new HttpError(415,'Use a JSON request body.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({destroyOnReturn:false})) {
    size += chunk.length;
    if (size > 4096) {
      req.resume();
      throw new HttpError(413,'Request is too large.');
    }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new HttpError(400,'Invalid JSON body.'); }
}
function securityHeaders(res) {
  res.setHeader('Content-Security-Policy',"default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
}
export function makeServer(db, config = {}) {
  const authPerIp = rateLimiter(12, 15*60*1000);
  const authGlobal = rateLimiter(90,60*1000);
  let authInFlight = 0;
  const secure = Boolean(config.publicOrigin?.startsWith('https://'));
  const server = createServer(async (req,res) => {
    securityHeaders(res);
    try {
      const {pathname,searchParams} = new URL(req.url,'http://localhost');
      const method = req.method;
      if (!pathname.startsWith('/api/')) return await staticFile(req,res,pathname);
      if (method !== 'GET') {
        const origin = config.publicOrigin || (req.socket.encrypted ? 'https://' : 'http://') + req.headers.host;
        if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
          throw new HttpError(403,'Cross-origin requests are blocked.');
        }
      }
      if (pathname === '/api/health' && method === 'GET') {
        db.prepare('SELECT 1').get();
        return json(res,200,{ok:true});
      }
      if (pathname === '/api/jobs' && method === 'GET') {
        const result = searchJobs(db,searchParams);
        return json(res,result.error?400:200,result);
      }
      if (['/api/login','/api/register'].includes(pathname) && method === 'POST') {
        const ip = config.trustProxy
          ? req.headers['x-forwarded-for']?.split(',').at(-1)?.trim() || req.socket.remoteAddress
          : req.socket.remoteAddress;
        if (!authPerIp(ip) || !authGlobal('all') || authInFlight >= 4) {
          res.setHeader('Retry-After','60');
          throw new HttpError(429,'Too many attempts. Try again later.');
        }
        const body = await jsonBody(req);
        if (authInFlight >= 4) throw new HttpError(429,'Too many attempts. Try again later.');
        authInFlight++;
        try {
          const {status,...result} = await authenticate(db,req,res,body,pathname.endsWith('register'),secure);
          return json(res,status,result);
        } finally { authInFlight--; }
      }
      if (pathname === '/api/logout' && method === 'POST') {
        signOut(db,req,res,secure);
        return json(res,200,{ok:true});
      }
      const user = getAccount(db,req);
      if (pathname === '/api/session' && method === 'GET') return json(res,200,{account:user?{email:user.email}:null});
      if (pathname === '/api/saved' || /^\/api\/saved\/[a-z0-9-]{1,80}$/.test(pathname)) {
        if (!user) throw new HttpError(401,'Sign in to manage your saved roles.');
        if (pathname === '/api/saved' && method === 'GET') return json(res,200,{jobs:savedJobs(db,user.id)});
        const id = pathname.split('/')[3];
        if (id && method === 'PUT') {
          if (!db.prepare('SELECT 1 FROM jobs WHERE id=?').get(id)) throw new HttpError(404,'Role not found.');
          db.prepare('INSERT INTO saved VALUES(?,?,?) ON CONFLICT DO NOTHING').run(user.id,id,Date.now());
          return json(res,200,{ok:true});
        }
        if (id && method === 'DELETE') {
          db.prepare('DELETE FROM saved WHERE user_id=? AND job_id=?').run(user.id,id);
          return json(res,200,{ok:true});
        }
      }
      return json(res,404,{error:'Not found.'});
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent) json(res,error.status || 500,{error:error.status ? error.message : 'The server encountered an error.'});
      else res.end();
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 10_000;
  return server;
}
if (import.meta.main) {
  const db = openDb(process.env.DB_PATH || './data/fieldwork.sqlite');
  const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : undefined;
  makeServer(db,{publicOrigin,trustProxy:process.env.TRUST_PROXY === '1'})
    .listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',() => {
      console.log('Fieldwork listening on port ' + (process.env.PORT || 3000));
    });
}
