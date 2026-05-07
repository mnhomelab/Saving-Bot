'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// dashboard.js — Live Monitoring Dashboard
// Auth: whitelisted numbers get a persistent token via WhatsApp.
//       Visiting /auth?token=xxx sets a long-lived session.
//       Without a valid token, the login page prompts for manual entry.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.DASHBOARD_PORT || 3001;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STATE
// ─────────────────────────────────────────────────────────────────────────────
const state = {
    botOnline:    false,
    startedAt:    null,
    whitelist:    [],
    schedules:    [],
    activityLog:  [],
    monthSummary: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN STORE  — persistent (no expiry), reusable, one token per number
// ─────────────────────────────────────────────────────────────────────────────
const tokenToNumber = new Map();   // token  → number
const numberToToken = new Map();   // number → token

// Sessions — long-lived (30 days)
const sessions   = new Map();      // sessionId → { number, created }
const sseClients = new Set();

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API  (called by index.js)
// ─────────────────────────────────────────────────────────────────────────────

function setBotOnline(val) {
    state.botOnline = val;
    state.startedAt = val ? new Date() : null;
    broadcast();
}

function setWhitelist(numbers) {
    state.whitelist = numbers;
    broadcast();
}

function setSchedules(schedules) {
    state.schedules = schedules;
    broadcast();
}

function setMonthSummary(summary) {
    state.monthSummary = summary;
    broadcast();
}

function logActivity(number, message, direction = 'in') {
    state.activityLog.unshift({
        time:      new Date().toISOString(),
        number:    maskNumber(String(number)),
        message:   message.length > 80 ? message.slice(0, 77) + '…' : message,
        direction,
    });
    if (state.activityLog.length > 50) state.activityLog.pop();
    broadcast();
}

/**
 * Returns the persistent token URL for a whitelisted number.
 * Re-uses the same token if one already exists for this number.
 */
function generateToken(number) {
    let token = numberToToken.get(number);
    if (!token) {
        token = crypto.randomBytes(32).toString('hex');
        tokenToNumber.set(token, number);
        numberToToken.set(number, token);
    }
    const host = (process.env.DASHBOARD_HOST || `http://localhost:${PORT}`).replace(/\/$/, '');
    return `${host}/auth?token=${token}`;
}

/** Also expose the raw token (for showing in WhatsApp without full URL) */
function getRawToken(number) {
    if (!numberToToken.has(number)) generateToken(number); // ensure created
    return numberToToken.get(number);
}

/** Revoke a number's token (e.g. removed from whitelist) */
function revokeToken(number) {
    const token = numberToToken.get(number);
    if (token) tokenToNumber.delete(token);
    numberToToken.delete(number);
}

function isRunning() { return !!server; }

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function maskNumber(n) {
    return n.length > 6 ? n.slice(0, 3) + '****' + n.slice(-3) : n;
}

function broadcast() {
    const data = JSON.stringify(snapshot());
    for (const res of sseClients) res.write(`data: ${data}\n\n`);
}

function snapshot() {
    return {
        botOnline:    state.botOnline,
        startedAt:    state.startedAt,
        whitelist:    state.whitelist.map(maskNumber),
        schedules:    state.schedules,
        activityLog:  state.activityLog,
        monthSummary: state.monthSummary,
        activeUsers:  sessions.size,
        timestamp:    new Date().toISOString(),
    };
}

function validateToken(token) {
    if (!token) return null;
    return tokenToNumber.get(token.trim()) || null;
}

function createSession(number) {
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { number, created: Date.now() });
    return sid;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE — cookie parser
// ─────────────────────────────────────────────────────────────────────────────
app.use((req, _, next) => {
    req.cookies = Object.fromEntries(
        (req.headers.cookie || '').split(';')
            .map(c => c.trim().split('=').map(s => decodeURIComponent(s || '')))
            .filter(([k]) => k)
    );
    next();
});

function requireSession(req, res, next) {
    const sid = req.cookies?.dsid;
    if (sid && sessions.has(sid)) return next();
    res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET /auth?token=xxx  — link from WhatsApp, auto-login
app.get('/auth', (req, res) => {
    const number = validateToken(req.query.token || '');
    if (!number) return res.redirect('/login?error=invalid');
    const sid = createSession(number);
    res.setHeader('Set-Cookie', `dsid=${sid}; HttpOnly; Path=/; Max-Age=${30 * 24 * 3600}`);
    res.redirect('/');
});

// GET /login — token entry page
app.get('/login', (req, res) => res.send(loginPage(req.query.error, req.query.next)));

// POST /login — manual token submission
app.post('/login', (req, res) => {
    const token  = (req.body.token || '').trim();
    const next   = (req.body.next  || '/');
    const number = validateToken(token);
    if (!number) return res.send(loginPage('invalid', next));
    const sid = createSession(number);
    res.setHeader('Set-Cookie', `dsid=${sid}; HttpOnly; Path=/; Max-Age=${30 * 24 * 3600}`);
    res.redirect(next.startsWith('/') ? next : '/');
});

// Dashboard (protected)
app.get('/', requireSession, (_, res) => res.send(dashboardHtml()));

// SSE live feed (protected)
app.get('/events', requireSession, (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
});

// Polling fallback (protected)
app.get('/api/data', requireSession, (_, res) => res.json(snapshot()));

// ─────────────────────────────────────────────────────────────────────────────
// HTML — LOGIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

function loginPage(error, next) {
    const errHtml = error === 'invalid'
        ? `<div class="error">❌ Invalid token. Please check and try again.</div>`
        : '';
    return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard · Sign In</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Mono',monospace;background:#0a0f1e;color:#e2e8f0;min-height:100vh;
  display:flex;align-items:center;justify-content:center;padding:20px}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(ellipse 70% 50% at 50% -10%,#0f3460 0%,transparent 70%),
             radial-gradient(ellipse 30% 30% at 85% 85%,#0f766e18 0%,transparent 60%)}
.card{position:relative;z-index:1;background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:44px 36px;
  max-width:400px;width:100%;backdrop-filter:blur(20px)}
.icon{font-size:44px;text-align:center;margin-bottom:20px;display:block;
  filter:drop-shadow(0 0 24px #0f766e88)}
h2{font-family:'Syne',sans-serif;font-size:20px;font-weight:800;text-align:center;margin-bottom:8px;
  background:linear-gradient(135deg,#e2e8f0,#94d5cd);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.sub{text-align:center;color:#4b5563;font-size:12px;line-height:1.9;margin-bottom:28px}
.sub code{background:#1e293b;color:#4ade80;padding:2px 8px;border-radius:4px;font-size:11px}
label{display:block;font-size:10px;color:#64748b;text-transform:uppercase;
  letter-spacing:.8px;margin-bottom:8px;font-weight:500}
input[type=text]{width:100%;background:#111827;border:1px solid rgba(255,255,255,.1);
  border-radius:10px;padding:13px 14px;color:#e2e8f0;font-family:'DM Mono',monospace;
  font-size:12px;outline:none;transition:border-color .2s;margin-bottom:14px;letter-spacing:.03em}
input[type=text]:focus{border-color:#0f766e;box-shadow:0 0 0 3px rgba(15,118,110,.15)}
input[type=text]::placeholder{color:#2d3748}
button{width:100%;background:linear-gradient(135deg,#0f766e,#1e40af);border:none;
  border-radius:10px;padding:13px;color:white;font-family:'Syne',sans-serif;
  font-size:14px;font-weight:700;cursor:pointer;transition:opacity .15s;letter-spacing:.02em}
button:hover{opacity:.87}
button:active{opacity:.75}
.error{background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.25);
  color:#f87171;border-radius:10px;padding:11px 14px;font-size:12px;
  margin-bottom:18px;text-align:center;line-height:1.5}
.hint{text-align:center;font-size:11px;color:#374151;margin-top:18px;line-height:1.8}
.hint span{color:#0f766e}
</style></head><body>
<div class="card">
  <span class="icon">💰</span>
  <h2>Saving Bot Dashboard</h2>
  <p class="sub">
    Send <code>Preview Dashboard</code> to the bot on WhatsApp<br>
    to get your token, then paste it below.
  </p>
  ${errHtml}
  <form method="POST" action="/login">
    <input type="hidden" name="next" value="${next || '/'}">
    <label>Your access token</label>
    <input type="text" name="token" placeholder="Paste your token here…"
           autocomplete="off" autocorrect="off" autocapitalize="off"
           spellcheck="false" autofocus>
    <button type="submit">Open Dashboard →</button>
  </form>
  <p class="hint">🔒 Only <span>whitelisted numbers</span> can access this dashboard.</p>
</div></body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML — DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

function dashboardHtml() {
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>💰 Saving Bot · Live Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500;1,400&family=Syne:wght@600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0f1e;--surface:#111827;--surface2:#1a2235;--border:rgba(255,255,255,.07);
  --text:#e2e8f0;--muted:#4b5563;--accent:#0f766e;--accent2:#1e40af;
  --green:#4ade80;--red:#f87171;--blue:#60a5fa;--yellow:#fbbf24;
}
body{font-family:'DM Mono',monospace;background:var(--bg);color:var(--text);min-height:100vh;font-size:13px}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(ellipse 70% 50% at 50% -10%,#0f3460 0%,transparent 70%),
             radial-gradient(ellipse 30% 30% at 90% 90%,#0f766e15 0%,transparent 60%)}
.header{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;
  padding:14px 20px;border-bottom:1px solid var(--border);
  background:rgba(10,15,30,.85);backdrop-filter:blur(16px)}
.header h1{font-family:'Syne',sans-serif;font-size:16px;font-weight:800;
  background:linear-gradient(135deg,#e2e8f0,#94d5cd);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header .sub{font-size:11px;color:var(--muted);margin-top:2px}
.live-pill{display:flex;align-items:center;gap:6px;border-radius:20px;padding:5px 12px;font-size:11px;font-weight:500;
  background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.2);color:#4ade80}
.live-pill.offline{background:rgba(248,113,113,.08);border-color:rgba(248,113,113,.2);color:#f87171}
.live-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:blink 1.4s ease-in-out infinite}
.live-dot.offline{animation:none}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
.page{position:relative;z-index:1;padding:16px;max-width:900px;margin:0 auto}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;transition:border-color .2s}
.stat:hover{border-color:rgba(255,255,255,.15)}
.stat-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px}
.stat-value{font-family:'Syne',sans-serif;font-size:24px;font-weight:700;line-height:1}
.stat-sub{font-size:10px;color:var(--muted);margin-top:4px}
.v-green{color:var(--green)}.v-red{color:var(--red)}.v-blue{color:var(--blue)}.v-yellow{color:var(--yellow)}.v-white{color:var(--text)}
.block{background:var(--surface);border:1px solid var(--border);border-radius:14px;margin-bottom:12px;overflow:hidden}
.block-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)}
.block-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:700}
.block-badge{font-size:10px;color:var(--muted);background:var(--surface2);border-radius:6px;padding:2px 8px}
.block-body{padding:14px 16px}
.fin-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)}
.fin-row:last-child{border:none}
.fin-label{color:var(--muted)}.fin-val{font-weight:500}
.sched-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)}
.sched-row:last-child{border:none}
.sched-cron{font-size:11px;color:var(--accent);background:rgba(15,118,110,.1);border-radius:6px;padding:2px 8px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{background:rgba(15,118,110,.1);border:1px solid rgba(15,118,110,.25);color:#94d5cd;
  border-radius:20px;padding:4px 12px;font-size:11px;font-family:'DM Mono',monospace}
.log-row{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);align-items:flex-start}
.log-row:last-child{border:none}
.log-bar{width:2px;background:var(--accent);border-radius:2px;flex-shrink:0;align-self:stretch;min-height:20px}
.log-bar.out{background:var(--accent2)}
.log-time{color:var(--muted);min-width:54px;font-size:11px;padding-top:1px}
.log-num{color:var(--text);min-width:90px;font-size:11px;opacity:.7}
.log-msg{color:var(--text);flex:1;line-height:1.5}
.log-dir{font-size:10px;color:var(--muted);margin-top:2px}
.empty{color:var(--muted);font-size:12px;padding:4px 0;font-style:italic}
.footer{text-align:center;padding:20px;color:var(--muted);font-size:11px}
</style></head><body>
<div class="header">
  <div>
    <h1>💰 Saving Bot Dashboard</h1>
    <div class="sub" id="uptime-sub">Connecting…</div>
  </div>
  <div id="live-pill" class="live-pill offline">
    <span class="live-dot offline" id="live-dot"></span>
    <span id="live-label">Offline</span>
  </div>
</div>
<div class="page">
  <div class="stat-grid">
    <div class="stat"><div class="stat-label">Bot Status</div><div class="stat-value v-white" id="s-status">—</div><div class="stat-sub" id="s-uptime"></div></div>
    <div class="stat"><div class="stat-label">Whitelisted</div><div class="stat-value v-blue" id="s-wl">—</div><div class="stat-sub">users</div></div>
    <div class="stat"><div class="stat-label">Dashboard Viewers</div><div class="stat-value v-yellow" id="s-viewers">—</div><div class="stat-sub">active sessions</div></div>
    <div class="stat"><div class="stat-label">Budget Balance</div><div class="stat-value v-green" id="s-budget">—</div><div class="stat-sub">can use (bank)</div></div>
    <div class="stat"><div class="stat-label">Balance Left</div><div class="stat-value" id="s-left">—</div><div class="stat-sub">have left (bank)</div></div>
  </div>
  <div class="block">
    <div class="block-head"><span class="block-title">⏰ Scheduled Jobs</span><span class="block-badge" id="b-sched-count">—</span></div>
    <div class="block-body" id="b-schedules"><div class="empty">Loading…</div></div>
  </div>
  <div class="block">
    <div class="block-head"><span class="block-title">🔒 Whitelisted Numbers</span><span class="block-badge" id="b-wl-count">—</span></div>
    <div class="block-body"><div class="chips" id="b-whitelist"></div></div>
  </div>
  <div class="block">
    <div class="block-head"><span class="block-title">💰 Current Month Summary</span><span class="block-badge" id="b-month-label">—</span></div>
    <div class="block-body" id="b-finance"><div class="empty">Loading…</div></div>
  </div>
  <div class="block">
    <div class="block-head"><span class="block-title">💬 Live Activity Log</span><span class="block-badge" id="b-log-count">—</span></div>
    <div class="block-body" id="b-activity"><div class="empty">Waiting for messages…</div></div>
  </div>
  <div class="footer">Last updated: <span id="last-upd">—</span> · Saving-Bot-v0.1</div>
</div>
<script>
const N=n=>(n||0).toLocaleString('en-PK'),col=n=>n>=0?'v-green':'v-red';
const fmtT=iso=>new Date(iso).toLocaleTimeString('en-PK',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const fmtS=iso=>new Date(iso).toLocaleTimeString('en-PK',{hour:'2-digit',minute:'2-digit'});
function render(d){
  const o=d.botOnline;
  document.getElementById('live-pill').className='live-pill'+(o?'':' offline');
  document.getElementById('live-dot').className='live-dot'+(o?'':' offline');
  document.getElementById('live-label').textContent=o?'Live':'Offline';
  document.getElementById('uptime-sub').textContent=o&&d.startedAt?'Running since '+fmtS(d.startedAt):'Bot is offline';
  document.getElementById('s-status').textContent=o?'🟢 Online':'🔴 Offline';
  document.getElementById('s-uptime').textContent=o&&d.startedAt?'since '+fmtS(d.startedAt):'';
  document.getElementById('s-wl').textContent=d.whitelist.length;
  document.getElementById('s-viewers').textContent=d.activeUsers;
  const ms=d.monthSummary;
  if(ms){
    const diff=(ms.balanceHaveLeft||0)-(ms.balanceCanUse||0);
    document.getElementById('s-budget').textContent=N(ms.balanceCanUse);
    const le=document.getElementById('s-left');
    le.textContent=N(ms.balanceHaveLeft);le.className='stat-value '+col(ms.balanceHaveLeft||0);
    document.getElementById('b-month-label').textContent=ms.month||'—';
    document.getElementById('b-finance').innerHTML=[
      ['Total Income',N(ms.totalIncome),'v-green'],['Total Expenses',N(ms.totalExpenses),'v-red'],
      ['Net',(ms.net>=0?'+':'')+N(ms.net),col(ms.net||0)],
      ['Petty Cash — Available',N(ms.pettyCashAvailable),'v-blue'],
      ['Petty Cash — Used',N(ms.pettyCashUsed),'v-red'],
      ['Petty Cash — Left',N(ms.pettyCashLeft),col(ms.pettyCashLeft||0)],
      ['Budget Balance (Can Use)',N(ms.balanceCanUse),'v-green'],
      ['Balance I Have Left',N(ms.balanceHaveLeft),col(ms.balanceHaveLeft||0)],
      ['Difference',(diff>=0?'+':'')+N(diff),col(diff)],
    ].map(([l,v,c])=>\`<div class="fin-row"><span class="fin-label">\${l}</span><span class="fin-val \${c}">\${v}</span></div>\`).join('');
  }
  document.getElementById('b-sched-count').textContent=(d.schedules.length||0)+' jobs';
  document.getElementById('b-schedules').innerHTML=d.schedules.length
    ?d.schedules.map(s=>\`<div class="sched-row"><span>\${s.label}</span><span class="sched-cron">\${s.cron}</span></div>\`).join('')
    :'<div class="empty">No schedules</div>';
  document.getElementById('b-wl-count').textContent=d.whitelist.length;
  document.getElementById('b-whitelist').innerHTML=d.whitelist.map(n=>\`<span class="chip">\${n}</span>\`).join('')||'<span class="empty">None</span>';
  document.getElementById('b-log-count').textContent=(d.activityLog.length||0)+' events';
  document.getElementById('b-activity').innerHTML=d.activityLog.length
    ?d.activityLog.map(a=>\`<div class="log-row">
      <div class="log-bar \${a.direction==='out'?'out':''}"></div>
      <span class="log-time">\${fmtT(a.time)}</span>
      <span class="log-num">\${a.number}</span>
      <div><div class="log-msg">\${a.message}</div><div class="log-dir">\${a.direction==='out'?'↑ sent':'↓ received'}</div></div>
    </div>\`).join('')
    :'<div class="empty">Waiting for messages…</div>';
  document.getElementById('last-upd').textContent=new Date().toLocaleTimeString('en-PK');
}
const es=new EventSource('/events');
es.onmessage=e=>{try{render(JSON.parse(e.data))}catch(_){}};
es.onerror=()=>{document.getElementById('uptime-sub').textContent='Reconnecting…'};
setInterval(()=>fetch('/api/data').then(r=>r.json()).then(render).catch(()=>{}),30_000);
</script></body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVER LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────
let server = null;

function startDashboard() {
    if (server) return { ok: false, msg: 'Dashboard is already running.' };
    server = app.listen(PORT, () => console.log(`📊 Dashboard live → port ${PORT}`));
    server.on('error', err => { console.error('Dashboard error:', err.message); server = null; });
    return { ok: true, msg: `Dashboard started on port ${PORT}` };
}

function stopDashboard() {
    if (!server) return { ok: false, msg: 'Dashboard is not running.' };
    server.close();
    server = null;
    sseClients.clear();
    sessions.clear();
    return { ok: true, msg: 'Dashboard stopped. All sessions cleared.' };
}

module.exports = {
    startDashboard, stopDashboard, isRunning,
    generateToken,  getRawToken,   revokeToken,
    setBotOnline,   setWhitelist,  setSchedules,
    setMonthSummary, logActivity,
};