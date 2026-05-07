'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// dashboard.js — Live Monitoring Dashboard
// Token-protected: only whitelisted WhatsApp numbers can access
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.DASHBOARD_PORT || 3001;

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STATE  (bot writes here via exported functions)
// ─────────────────────────────────────────────────────────────────────────────
const state = {
    botOnline:    false,
    startedAt:    null,
    whitelist:    [],
    schedules:    [],        // [{ label, cron }]
    activityLog:  [],        // last 50 events  [{ time, number, message, direction }]
    monthSummary: null,      // from excel.js loadMonthData
};

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN STORE  (token → { number, expires })  — one-time, 1-hour TTL
// ─────────────────────────────────────────────────────────────────────────────
const tokens   = new Map();
const sessions = new Map();   // sessionId → { number, created }
const sseClients = new Set();

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API  (called by index.js / bot)
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
    // schedules: [{ label: '11:15 AM PKT', cron: '15 11 * * *' }]
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

/** Returns a one-time auth URL to send to the user */
function generateToken(number) {
    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, { number, expires: Date.now() + 3_600_000 });
    const host = (process.env.DASHBOARD_HOST || `http://localhost:${PORT}`).replace(/\/$/, '');
    return `${host}/auth?token=${token}`;
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

// ─────────────────────────────────────────────────────────────────────────────
// COOKIE PARSER  (no deps)
// ─────────────────────────────────────────────────────────────────────────────
app.use((req, _, next) => {
    req.cookies = Object.fromEntries(
        (req.headers.cookie || '').split(';')
            .map(c => c.trim().split('=').map(s => decodeURIComponent(s || '')))
            .filter(([k]) => k)
    );
    next();
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────
function requireSession(req, res, next) {
    const sid = req.cookies?.dsid;
    if (sid && sessions.has(sid)) return next();
    res.redirect('/login');
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// One-time token auth → set session cookie → redirect to dashboard
app.get('/auth', (req, res) => {
    const entry = tokens.get(req.query.token || '');
    if (!entry || Date.now() > entry.expires) {
        tokens.delete(req.query.token || '');
        return res.status(401).send(errorPage('Link expired or invalid.<br>Ask the bot for a fresh preview link.'));
    }
    tokens.delete(req.query.token); // one-time use
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { number: entry.number, created: Date.now() });
    res.setHeader('Set-Cookie', `dsid=${sid}; HttpOnly; Path=/; Max-Age=3600`);
    res.redirect('/');
});

// Locked page shown when no session
app.get('/login', (_, res) => res.send(loginPage()));

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
// HTML PAGES
// ─────────────────────────────────────────────────────────────────────────────

function loginPage() {
    return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard · Access Required</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Mono',monospace;background:#0a0f1e;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden}
.bg{position:fixed;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 0%,#0f3460 0%,transparent 70%),radial-gradient(ellipse 40% 40% at 80% 80%,#0f766e22 0%,transparent 60%)}
.card{position:relative;z-index:1;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:48px 40px;text-align:center;max-width:360px;backdrop-filter:blur(20px)}
.lock{font-size:52px;margin-bottom:20px;filter:drop-shadow(0 0 20px #0f766e88)}
h2{font-family:'Syne',sans-serif;font-size:22px;margin-bottom:12px;background:linear-gradient(135deg,#e2e8f0,#94d5cd);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
p{color:#64748b;font-size:12px;line-height:1.8}
code{background:#1e293b;padding:2px 8px;border-radius:4px;color:#4ade80;font-size:12px}
</style></head><body>
<div class="bg"></div>
<div class="card">
  <div class="lock">🔒</div>
  <h2>Access Required</h2>
  <p>This dashboard is private.<br>Send <code>Preview Dashboard</code> to the bot on WhatsApp to receive your secure one-time access link.</p>
</div></body></html>`;
}

function errorPage(msg) {
    return `<!DOCTYPE html><html><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard · Error</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Mono',monospace;background:#0a0f1e;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.3);border-radius:20px;padding:40px;text-align:center;max-width:340px}
h2{font-family:'Syne',sans-serif;color:#f87171;margin-bottom:12px}p{color:#94a3b8;font-size:12px;line-height:1.8}
</style></head><body>
<div class="card"><h2>⚠️ Link Error</h2><p>${msg}</p></div></body></html>`;
}

function dashboardHtml() {
    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>💰 Saving Bot · Live Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500;1,400&family=Syne:wght@600;700;800&display=swap" rel="stylesheet">
<style>
/* ── Reset & Base ── */
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0f1e;--surface:#111827;--surface2:#1a2235;--border:rgba(255,255,255,.07);
  --text:#e2e8f0;--muted:#4b5563;--accent:#0f766e;--accent2:#1e40af;
  --green:#4ade80;--red:#f87171;--blue:#60a5fa;--yellow:#fbbf24;
}
body{font-family:'DM Mono',monospace;background:var(--bg);color:var(--text);min-height:100vh;font-size:13px}

/* ── Background ── */
body::before{content:'';position:fixed;inset:0;pointer-events:none;
  background:
    radial-gradient(ellipse 70% 50% at 50% -10%,#0f3460 0%,transparent 70%),
    radial-gradient(ellipse 30% 30% at 90% 90%,#0f766e15 0%,transparent 60%);
  z-index:0}

/* ── Header ── */
.header{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;
  padding:16px 20px;border-bottom:1px solid var(--border);background:rgba(17,24,39,.8);backdrop-filter:blur(16px);
  position:sticky;top:0}
.header-left h1{font-family:'Syne',sans-serif;font-size:17px;font-weight:800;
  background:linear-gradient(135deg,#e2e8f0 0%,#94d5cd 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header-left .sub{font-size:11px;color:var(--muted);margin-top:2px}
.live-pill{display:flex;align-items:center;gap:6px;background:rgba(74,222,128,.08);
  border:1px solid rgba(74,222,128,.2);border-radius:20px;padding:5px 12px;font-size:11px;color:#4ade80;font-weight:500}
.live-pill.offline{background:rgba(248,113,113,.08);border-color:rgba(248,113,113,.2);color:#f87171}
.live-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:blink 1.4s ease-in-out infinite}
.live-dot.offline{animation:none}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}

/* ── Layout ── */
.page{position:relative;z-index:1;padding:16px;max-width:900px;margin:0 auto}

/* ── Stat Grid ── */
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:16px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;transition:border-color .2s}
.stat:hover{border-color:rgba(255,255,255,.15)}
.stat-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px}
.stat-value{font-family:'Syne',sans-serif;font-size:24px;font-weight:700;line-height:1}
.stat-sub{font-size:10px;color:var(--muted);margin-top:4px}
.v-green{color:var(--green)}.v-red{color:var(--red)}.v-blue{color:var(--blue)}.v-yellow{color:var(--yellow)}.v-white{color:var(--text)}

/* ── Blocks ── */
.block{background:var(--surface);border:1px solid var(--border);border-radius:14px;margin-bottom:12px;overflow:hidden}
.block-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)}
.block-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:var(--text)}
.block-badge{font-size:10px;color:var(--muted);background:var(--surface2);border-radius:6px;padding:2px 8px}
.block-body{padding:14px 16px}

/* ── Finance rows ── */
.fin-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)}
.fin-row:last-child{border:none}
.fin-label{color:var(--muted)}
.fin-val{font-weight:500}

/* ── Schedule rows ── */
.sched-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)}
.sched-row:last-child{border:none}
.sched-label{color:var(--text)}
.sched-cron{font-size:11px;color:var(--accent);background:rgba(15,118,110,.1);border-radius:6px;padding:2px 8px;font-family:'DM Mono',monospace}

/* ── Whitelist chips ── */
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{background:rgba(15,118,110,.1);border:1px solid rgba(15,118,110,.25);color:#94d5cd;
  border-radius:20px;padding:4px 12px;font-size:11px;font-family:'DM Mono',monospace}

/* ── Activity log ── */
.log-row{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);align-items:flex-start}
.log-row:last-child{border:none}
.log-bar{width:2px;min-height:100%;background:var(--accent);border-radius:2px;flex-shrink:0;align-self:stretch}
.log-bar.out{background:var(--accent2)}
.log-time{color:var(--muted);min-width:54px;font-size:11px;padding-top:1px}
.log-num{color:var(--text);min-width:90px;font-size:11px;opacity:.7}
.log-msg{color:var(--text);flex:1;line-height:1.5}
.log-dir{font-size:10px;color:var(--muted);margin-top:2px}

/* ── Empty states ── */
.empty{color:var(--muted);font-size:12px;padding:8px 0;font-style:italic}

/* ── Footer ── */
.footer{text-align:center;padding:20px;color:var(--muted);font-size:11px}
</style></head><body>

<!-- Header -->
<div class="header">
  <div class="header-left">
    <h1>💰 Saving Bot Dashboard</h1>
    <div class="sub" id="uptime-sub">Connecting…</div>
  </div>
  <div id="live-pill" class="live-pill offline">
    <span class="live-dot offline" id="live-dot"></span>
    <span id="live-label">Offline</span>
  </div>
</div>

<div class="page">

  <!-- Stat cards -->
  <div class="stat-grid">
    <div class="stat">
      <div class="stat-label">Bot Status</div>
      <div class="stat-value v-white" id="s-status">—</div>
      <div class="stat-sub" id="s-uptime"></div>
    </div>
    <div class="stat">
      <div class="stat-label">Whitelisted Users</div>
      <div class="stat-value v-blue" id="s-wl">—</div>
      <div class="stat-sub">numbers</div>
    </div>
    <div class="stat">
      <div class="stat-label">Dashboard Viewers</div>
      <div class="stat-value v-yellow" id="s-viewers">—</div>
      <div class="stat-sub">active sessions</div>
    </div>
    <div class="stat">
      <div class="stat-label">Budget Balance</div>
      <div class="stat-value v-green" id="s-budget">—</div>
      <div class="stat-sub">can use (bank)</div>
    </div>
    <div class="stat">
      <div class="stat-label">Balance Left</div>
      <div class="stat-value" id="s-left">—</div>
      <div class="stat-sub">have left (bank)</div>
    </div>
  </div>

  <!-- Scheduled Jobs -->
  <div class="block">
    <div class="block-head">
      <span class="block-title">⏰ Scheduled Jobs</span>
      <span class="block-badge" id="b-sched-count">0 jobs</span>
    </div>
    <div class="block-body" id="b-schedules"><div class="empty">Loading…</div></div>
  </div>

  <!-- Whitelist -->
  <div class="block">
    <div class="block-head">
      <span class="block-title">🔒 Whitelisted Numbers</span>
      <span class="block-badge" id="b-wl-count">0</span>
    </div>
    <div class="block-body"><div class="chips" id="b-whitelist"></div></div>
  </div>

  <!-- Finance -->
  <div class="block">
    <div class="block-head">
      <span class="block-title">💰 Current Month Summary</span>
      <span class="block-badge" id="b-month-label">—</span>
    </div>
    <div class="block-body" id="b-finance"><div class="empty">Loading…</div></div>
  </div>

  <!-- Activity Log -->
  <div class="block">
    <div class="block-head">
      <span class="block-title">💬 Live Activity Log</span>
      <span class="block-badge" id="b-log-count">0 events</span>
    </div>
    <div class="block-body" id="b-activity"><div class="empty">Waiting for messages…</div></div>
  </div>

  <div class="footer">Last updated: <span id="last-upd">—</span> · Saving-Bot-v0.1</div>
</div>

<script>
const N = n => (n || 0).toLocaleString('en-PK');
const col = n => n >= 0 ? 'v-green' : 'v-red';
const fmtTime = iso => new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fmtShort = iso => new Date(iso).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' });

function render(d) {
    // ── Header live pill ──
    const online = d.botOnline;
    const pill = document.getElementById('live-pill');
    const dot  = document.getElementById('live-dot');
    const lbl  = document.getElementById('live-label');
    pill.className = 'live-pill' + (online ? '' : ' offline');
    dot.className  = 'live-dot'  + (online ? '' : ' offline');
    lbl.textContent = online ? 'Live' : 'Offline';
    document.getElementById('uptime-sub').textContent = online && d.startedAt
        ? 'Running since ' + fmtShort(d.startedAt)
        : 'Bot is offline';

    // ── Stat cards ──
    document.getElementById('s-status').textContent   = online ? '🟢 Online' : '🔴 Offline';
    document.getElementById('s-uptime').textContent   = online && d.startedAt ? 'since ' + fmtShort(d.startedAt) : '';
    document.getElementById('s-wl').textContent       = d.whitelist.length;
    document.getElementById('s-viewers').textContent  = d.activeUsers;

    const ms = d.monthSummary;
    if (ms) {
        const diff = (ms.balanceHaveLeft || 0) - (ms.balanceCanUse || 0);
        document.getElementById('s-budget').textContent = N(ms.balanceCanUse);
        const le = document.getElementById('s-left');
        le.textContent = N(ms.balanceHaveLeft);
        le.className = 'stat-value ' + col(ms.balanceHaveLeft || 0);
        document.getElementById('b-month-label').textContent = ms.month || '—';
        document.getElementById('b-finance').innerHTML = [
            ['Total Income',            N(ms.totalIncome),                              'v-green'],
            ['Total Expenses',          N(ms.totalExpenses),                            'v-red'],
            ['Net',                     (ms.net >= 0 ? '+' : '') + N(ms.net),           col(ms.net || 0)],
            ['Petty Cash — Available',  N(ms.pettyCashAvailable),                       'v-blue'],
            ['Petty Cash — Used',       N(ms.pettyCashUsed),                            'v-red'],
            ['Petty Cash — Left',       N(ms.pettyCashLeft),                            col(ms.pettyCashLeft || 0)],
            ['Budget Balance (Can Use)',N(ms.balanceCanUse),                            'v-green'],
            ['Balance I Have Left',     N(ms.balanceHaveLeft),                          col(ms.balanceHaveLeft || 0)],
            ['Difference',              (diff >= 0 ? '+' : '') + N(diff),               col(diff)],
        ].map(([l, v, c]) =>
            \`<div class="fin-row"><span class="fin-label">\${l}</span><span class="fin-val \${c}">\${v}</span></div>\`
        ).join('');
    }

    // ── Schedules ──
    document.getElementById('b-sched-count').textContent = (d.schedules.length || 0) + ' jobs';
    document.getElementById('b-schedules').innerHTML = d.schedules.length
        ? d.schedules.map(s => \`
            <div class="sched-row">
                <span class="sched-label">\${s.label}</span>
                <span class="sched-cron">\${s.cron}</span>
            </div>\`).join('')
        : '<div class="empty">No schedules found</div>';

    // ── Whitelist ──
    document.getElementById('b-wl-count').textContent = d.whitelist.length;
    document.getElementById('b-whitelist').innerHTML = d.whitelist
        .map(n => \`<span class="chip">\${n}</span>\`).join('') || '<span class="empty">No numbers</span>';

    // ── Activity ──
    document.getElementById('b-log-count').textContent = d.activityLog.length + ' events';
    document.getElementById('b-activity').innerHTML = d.activityLog.length
        ? d.activityLog.map(a => \`
            <div class="log-row">
                <div class="log-bar \${a.direction === 'out' ? 'out' : ''}"></div>
                <span class="log-time">\${fmtTime(a.time)}</span>
                <span class="log-num">\${a.number}</span>
                <div><div class="log-msg">\${a.message}</div><div class="log-dir">\${a.direction === 'out' ? '↑ sent' : '↓ received'}</div></div>
            </div>\`).join('')
        : '<div class="empty">Waiting for messages…</div>';

    document.getElementById('last-upd').textContent = new Date().toLocaleTimeString('en-PK');
}

// ── SSE connection ──
const es = new EventSource('/events');
es.onmessage = e => { try { render(JSON.parse(e.data)); } catch(_){} };
es.onerror = () => {
    document.getElementById('uptime-sub').textContent = 'Connection lost — retrying…';
};

// ── Polling fallback every 30s ──
setInterval(() => fetch('/api/data').then(r => r.json()).then(render).catch(() => {}), 30_000);
</script>
</body></html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVER LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────
let server = null;

function startDashboard() {
    if (server) return { ok: false, msg: 'Dashboard is already running.' };
    server = app.listen(PORT, () => console.log(`📊 Dashboard live on port ${PORT}`));
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
    startDashboard,
    stopDashboard,
    isRunning,
    generateToken,
    setBotOnline,
    setWhitelist,
    setSchedules,
    setMonthSummary,
    logActivity,
};
