import { fields } from './fields.js';
import { demoJobs, demoSearch } from './demo.js';

const paths = {
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',pin:'<path d="M20 10c0 5-8 10-8 10s-8-5-8-10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',moon:'<path d="M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10Z"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',bookmark:'<path d="M6 4h12v17l-6-4-6 4z"/>',grid:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16"/>',chart:'<path d="M4 4v16h16M8 15v-3m5 3V8m5 7V5"/>',engineering:'<path d="m5 19 8-8m-9 4 5 5m3-10 5 5 4-4-8-8-4 4 3 3Z"/>',
  case:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 13h18m-11 0v2h4v-2"/>',design:'<path d="m4 20 1-5L16 4l4 4L9 19l-5 1ZM14 6l4 4"/>',science:'<path d="M9 3h6m-5 0v7L5 19a1 1 0 0 0 1 2h12a1 1 0 0 0 1-2l-5-9V3M8 15h8"/>',people:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v1"/>',
};
const icon = name => '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
function store(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch {} }
let account = null, online = true, page = 'browse', field = '', cursor = null, requestId = 0, openedJob;
let jobs = [], saved = new Map(), localSaved = new Set(stored('fieldwork-example-saved',[]));
let theme = stored('fieldwork-theme', matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
function setTheme() {
  document.documentElement.dataset.theme = theme;
  $('theme').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  $('theme').ariaLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}
setTheme();
$('theme').onclick = () => { theme = theme === 'light' ? 'dark' : 'light'; store('fieldwork-theme', theme); setTheme(); };
document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const fieldOptions = [{ id:'',name:'All fields',icon:'grid' },...fields];
$('fields').innerHTML = fieldOptions.map(f => '<button class="field" type="button" data-field="'+f.id+'" aria-pressed="'+(!f.id)+'">'+icon(f.icon)+f.name+'</button>').join('');
$('fields').onclick = e => { const button = e.target.closest('[data-field]'); if (button) { field = button.dataset.field; show('browse'); } };
function updateFields() {
  $('fields').querySelectorAll('[data-field]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.field === field)));
}
function filters() {
  return {
    q:$('query').value.trim(), zip:$('zip').value.trim(), field,
    radius:Number($('radius').value), sort:$('sort').value,
    kind:$('intern').checked === $('full').checked ? '' : ($('intern').checked ? 'intern' : 'job'),
    remote:$('remote').checked, includeRemote:$('include-remote').checked,
  };
}
function query(p) {
  return new URLSearchParams(Object.entries(p).filter(([,v]) => v !== '' && v != null && v !== false)).toString();
}
async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    ...options, headers: options.body ? { 'Content-Type':'application/json' } : undefined,
  });
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    const error = new Error('The server returned an unexpected response.');
    error.status = res.status;
    throw error;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function isSaved(job) { return job.id.startsWith('demo-') && !account ? localSaved.has(job.id) : saved.has(job.id); }
function renderCount() {
  const n = account ? saved.size : localSaved.size;
  $('saved-count').hidden = n === 0;
  $('saved-count').textContent = n;
  $('account').textContent = account ? 'Account' : 'Sign in';
}
function dateLabel(date) {
  const days = Math.floor((Date.now()-Date.parse(date))/86400000);
  if (!Number.isFinite(days)) return '';
  if (days <= 0) return 'Added today';
  if (days < 7) return 'Added ' + days + (days === 1 ? ' day ago' : ' days ago');
  return 'Added ' + new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:days>365?'numeric':undefined}).format(new Date(date));
}
function metadata(job) {
  const distance = typeof job.distance === 'number' ? ' · ' + Math.round(job.distance) + ' mi' : '';
  return '<div class="metadata"><span class="badge">'+(job.kind === 'intern'?'Internship':'Job')+'</span><span>'+icon('pin')+esc(job.location || 'Location unspecified')+distance+'</span>'
    +(job.mode && job.mode !== 'Unspecified' ? '<span>'+esc(job.mode)+'</span>' : '')+(job.active === false ? '<span>Closed or unavailable</span>' : '')+'</div>';
}
function skillTags(job) {
  return '<div class="skills">'+job.skills.map(s => '<span class="skill">'+esc(s)+'</span>').join('')+'</div>';
}
function card(job) {
  const initials = job.company.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase();
  const tone = (job.company.codePointAt(0) || 0) % 4;
  return '<article class="card"><div class="card-top"><div class="identity"><div class="company-icon" data-tone="'+tone+'" aria-hidden="true">'+esc(initials)+'</div><div>'
    +'<h3><button data-open="'+esc(job.id)+'">'+esc(job.title)+'</button></h3><p class="company">'+esc(job.company)+'</p></div></div>'
    +'<button class="icon-button bookmark" data-save="'+esc(job.id)+'" aria-pressed="'+isSaved(job)+'" aria-label="'+(isSaved(job)?'Remove saved role':'Save role')+'">'+icon('bookmark')+'</button></div>'
    +metadata(job)+'<p class="summary">'+esc(job.summary)+'</p><div class="card-bottom">'+skillTags(job)+'<span class="date">'+esc(dateLabel(job.added))+'</span></div></article>';
}
function empty(title,body) {
  $('list').innerHTML = '<div class="empty"><strong>'+esc(title)+'</strong>'+esc(body)+'</div>';
}
function renderJobs() { $('list').innerHTML = jobs.map(card).join(''); }
async function show(nextPage = page, append = false) {
  const id = ++requestId;
  page = nextPage;
  const p = filters();
  const offset = append ? cursor : null;
  if (!append) cursor = null;
  updateFields();
  $('radius').disabled = !p.zip || p.remote;
  $('include-remote-label').hidden = !p.zip || p.remote;
  $('browse').classList.toggle('active',page === 'browse');
  $('saved').classList.toggle('active',page === 'saved');
  for (const name of ['browse','saved']) $(name).setAttribute('aria-current',page === name ? 'page' : 'false');
  $('results-title').textContent = page === 'saved' ? 'Saved opportunities' : (fields.find(f => f.id === field)?.name || 'Explore opportunities');
  $('sort').disabled = page === 'saved';
  $('more').hidden = true;
  $('feed-status').hidden = true;
  if (!append) { $('result-count').textContent = 'Loading…'; $('list').innerHTML = ''; }
  try {
    let result;
    if (page === 'saved') {
      const rows = account ? [...saved.values()] : demoJobs.filter(j => localSaved.has(j.id));
      result = { jobs:rows,total:rows.length,demo:!account && rows.length > 0 };
    } else if (online) {
      result = await api('/jobs?' + query({ ...p, offset }));
      if (result.demo) result = { ...result, ...demoSearch(p) };
    } else {
      result = demoSearch(p);
    }
    if (id !== requestId) return;
    jobs = append ? [...jobs, ...result.jobs] : result.jobs;
    cursor = result.next;
    $('more').hidden = cursor == null;
    $('result-count').textContent = result.total.toLocaleString() + (result.total === 1 ? ' opportunity' : ' opportunities');
    const status = [];
    if (result.demo) status.push('Example catalog · Sample roles are for exploring the interface.');
    if (result.freshness && !result.demo) status.push('Last successful sync ' + new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(result.freshness)));
    if (p.sort === 'popular' && page === 'browse') status.push('Ranked by public Bluesky engagement and Fieldwork saves, with recent listings first when tied.');
    if (status.length) { $('feed-status').textContent = status.join(' · '); $('feed-status').hidden = false; }
    if (jobs.length) renderJobs();
    else empty(page === 'saved' ? 'No saved opportunities yet' : 'No matching opportunities',
      page === 'saved' ? (account ? 'Save a role from Explore to find it here.' : 'Sign in to save live roles to your account.') :
      'Try another keyword, academic field, or search radius.');
  } catch (error) {
    if (id !== requestId) return;
    $('result-count').textContent = 'Search unavailable';
    if (!append) empty('Couldn’t load opportunities',error.message);
    else { $('feed-status').textContent = error.message; $('feed-status').hidden = false; $('more').hidden = false; }
  }
}
$('search').onsubmit = e => { e.preventDefault(); show('browse'); };
for (const id of ['intern','full','remote','include-remote','radius','sort']) $(id).onchange = () => { if ($('search').reportValidity()) show('browse'); };
$('zip').oninput = () => { $('radius').disabled = !/^\d{5}$/.test($('zip').value) || $('remote').checked; };
$('clear').onclick = () => {
  field = ''; $('search').reset();
  for (const id of ['intern','full','remote','include-remote']) $(id).checked = false;
  $('radius').value = '25'; $('sort').value = 'recent'; show('browse');
};
$('browse').onclick = () => show('browse');
$('saved').onclick = () => show('saved');
$('more').onclick = () => show(page,true);
$('close').onclick = () => $('dialog').close();
$('dialog').addEventListener('close',() => { openedJob = null; });
$('dialog').setAttribute('aria-labelledby','dialog-title');
function openDialog(content) {
  $('dialog-content').innerHTML = content;
  if (!$('dialog').open) $('dialog').showModal();
  $('dialog-content').querySelector('h2')?.setAttribute('id','dialog-title');
}
function details(job) {
  openedJob = job;
  const href = typeof job.url === 'string' && /^https:\/\//i.test(job.url) && job.active !== false ? job.url : '';
  const engagement = job.popularity ? '<p class="auth-note">Bluesky engagement: '+job.popularity+'</p>' : '';
  openDialog('<h2>'+esc(job.title)+'</h2><p class="company">'+esc(job.company)+' · '+esc(job.source)+'</p>'+metadata(job)
    +'<h3>About the role</h3><p class="summary">'+esc(job.summary)+'</p><h3>Likely skills</h3>'
    +(job.skills.length ? skillTags(job) : '<p class="auth-note">No specific skills could be inferred from the posting.</p>')+engagement
    +'<div class="detail-actions">'+(href ? '<a class="primary" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">View original posting '+icon('arrow')+'</a>' : '')
    +'<button class="secondary" id="detail-save">'+(isSaved(job) ? 'Remove saved role' : 'Save role')+'</button></div><p id="feedback" class="feedback" role="status"></p>');
  $('detail-save').onclick = () => toggleSave(job,$('detail-save'));
}
let pendingSave = null;
async function toggleSave(job, button) {
  if (!account && !job.id.startsWith('demo-')) { pendingSave = job; auth(false); return; }
  const wasSaved = isSaved(job);
  button.disabled = true;
  try {
    if (!account) {
      if (wasSaved) localSaved.delete(job.id); else localSaved.add(job.id);
      store('fieldwork-example-saved',[...localSaved]);
    } else {
      await api('/saved/' + encodeURIComponent(job.id),{ method:wasSaved?'DELETE':'PUT' });
      if (wasSaved) saved.delete(job.id); else saved.set(job.id,job);
    }
    renderCount();
    if (page === 'saved') await show('saved'); else renderJobs();
    if (openedJob?.id === job.id && $('dialog').open) details(job);
  } catch (e) {
    const feedback = $('feedback');
    if (feedback && $('dialog').open) feedback.textContent = e.message;
    else openDialog('<h2>Couldn’t save the role</h2><p>'+esc(e.message)+'</p>');
  } finally { button.disabled = false; }
}
$('list').onclick = e => {
  const button = e.target.closest('[data-open],[data-save]');
  if (!button) return;
  const job = jobs.find(j => j.id === (button.dataset.open || button.dataset.save));
  if (job) { if (button.dataset.open) details(job); else toggleSave(job,button); }
};
function auth(register) {
  openedJob = null;
  if (!online) { openDialog('<h2>Example mode</h2><p class="auth-note">Account sign-in is available in the server-backed build. Example bookmarks are stored in this browser.</p>'); return; }
  if (account) {
    openDialog('<h2>Your account</h2><p class="auth-note">'+esc(account.email)+'</p><div class="detail-actions"><button class="secondary" id="signout">Sign out</button></div><p id="feedback" class="feedback" role="status"></p>');
    $('signout').onclick = async () => {
      try { await api('/logout',{method:'POST'}); account=null; saved.clear(); renderCount(); $('dialog').close(); show(); }
      catch (error) { $('feedback').textContent=error.message; }
    };
    return;
  }
  openDialog('<h2>'+(register?'Create an account':'Sign in')+'</h2><p class="auth-note">Keep your saved opportunities across devices.</p>'
    +'<form class="auth" id="auth"><label>Email address<input type="email" name="email" autocomplete="email" maxlength="254" required></label>'
    +'<label>Password<input type="password" name="password" minlength="12" maxlength="128" autocomplete="'+(register?'new-password':'current-password')+'" required></label>'
    +(register?'<p class="auth-note">Use at least 12 characters.</p>':'')
    +'<button class="primary">'+(register?'Create account':'Sign in')+'</button><p id="feedback" class="feedback" role="status"></p></form>'
    +'<button class="text-button" id="switch-auth">'+(register?'Already have an account? Sign in':'New to Fieldwork? Create an account')+'</button>');
  $('switch-auth').onclick = () => auth(!register);
  $('auth').onsubmit = async e => {
    e.preventDefault();
    const form = e.currentTarget;
    form.querySelector('button').disabled = true;
    try {
      const data = await api(register?'/register':'/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});
      account = data.account;
      await refreshSaved();
      renderCount(); $('dialog').close(); await show();
      const target = pendingSave; pendingSave = null;
      if (target && !isSaved(target)) await toggleSave(target,form.querySelector('button'));
    } catch (error) { $('feedback').textContent = error.message; }
    finally { form.querySelector('button').disabled = false; }
  };
}
$('account').onclick = () => { pendingSave = null; auth(false); };
async function refreshSaved() {
  const data = await api('/saved');
  saved = new Map(data.jobs.map(job => [job.id,job]));
}
try {
  const data = await api('/session');
  account = data.account;
  if (account) await refreshSaved();
} catch (error) { if (error.status === 404) online = false; }
renderCount();
show();

