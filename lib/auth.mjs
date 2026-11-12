import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const lifetime = 60 * 60 * 24 * 30;
const digest = value => createHash('sha256').update(value).digest('hex');
const dummySalt = randomBytes(16).toString('hex');
const dummyKey = Buffer.alloc(64);
const cookieName = 'fieldwork_session';

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password,salt,64);
  return salt + ':' + key.toString('hex');
}
async function verify(password, encoded) {
  const [salt,hex] = (encoded ?? '').split(':');
  const key = await derive(password,salt || dummySalt,64);
  return timingSafeEqual(key,hex ? Buffer.from(hex,'hex') : dummyKey) && Boolean(encoded);
}
function token(req) {
  return req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length+1);
}
export function getAccount(db,req) {
  const value = token(req);
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return null;
  return db.prepare(`SELECT u.id,u.email FROM users u JOIN sessions s ON s.user_id=u.id
    WHERE s.token=? AND s.expires>?`).get(digest(value),Date.now()) ?? null;
}
function cookie(res,value,age,secure) {
  res.setHeader('Set-Cookie',cookieName+'='+value+'; HttpOnly; Path=/; SameSite=Lax; Max-Age='+age+(secure?'; Secure':''));
}
export function signOut(db,req,res,secure) {
  const value = token(req);
  if (value) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(value));
  cookie(res,'',0,secure);
}
export async function authenticate(db,req,res,body,register,secure) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<12 || password.length>128) {
    return {status:400,error:'Enter a valid email and a password of 12 to 128 characters.'};
  }
  let user;
  if (register) {
    const passwordHash = await hashPassword(password);
    const inserted = db.prepare('INSERT INTO users(email,password) VALUES(?,?) ON CONFLICT(email) DO NOTHING').run(email,passwordHash);
    if (!inserted.changes) return {status:409,error:'An account already uses that email.'};
    user = {id:inserted.lastInsertRowid,email};
  } else {
    user = db.prepare('SELECT id,email,password FROM users WHERE email=?').get(email);
    if (!await verify(password,user?.password)) return {status:401,error:'Email or password is incorrect.'};
  }
  const value = randomBytes(32).toString('hex');
  const old = token(req);
  if (old) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(old));
  db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(value),user.id,Date.now()+lifetime*1000);
  cookie(res,value,lifetime,secure);
  return {status:register?201:200,account:{email:user.email}};
}

export function rateLimiter(limit,interval) {
  const windows = new Map();
  let nextSweep = 0;
  return key => {
    const now = Date.now();
    if (now >= nextSweep) {
      for (const [id,entry] of windows) if (entry.end <= now) windows.delete(id);
      nextSweep = now + interval;
    }
    let entry = windows.get(key);
    if (!entry || entry.end <= now) {
      if (windows.size >= 10000) return false;
      entry = {count:0,end:now+interval};
      windows.set(key,entry);
    }
    return ++entry.count <= limit;
  };
}

