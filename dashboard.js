'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// dashboard.js — Live Monitoring Dashboard
// Auth: whitelisted numbers get a persistent token via WhatsApp.
//       Visiting /auth?token=xxx sets a long-lived session.
//       Without a valid token, the login page prompts for manual entry.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const { createEditorRouter } = require('./editor');
const crypto  = require('crypto');
const https   = require('https');

const app  = express();
const PORT = process.env.DASHBOARD_PORT || 3001;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── Auto-detect public IP if DASHBOARD_HOST not set ──────────────────────────
let detectedHost = process.env.DASHBOARD_HOST
    ? process.env.DASHBOARD_HOST.replace(/\/$/, '')
    : null;

function detectPublicIp() {
    return new Promise((resolve) => {
        https.get('https://api.ipify.org', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data.trim()));
        }).on('error', () => resolve(null));
    });
}

function getHost() {
    return detectedHost || `http://localhost:${PORT}`;
}

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
const shortToToken  = new Map();   // code   → token
// ── OTP store ─────────────────────────────────────────────────────────────────
const otpStore = new Map();  // phone → { code, expires, attempts, lastSent }
let _waClient  = null;
function setClient(client) { _waClient = client; }
function _cleanOtps() { const n=Date.now(); for(const[k,v]of otpStore) if(v.expires<n) otpStore.delete(k); }
const shortUrlCache = new Map();   // code   → is.gd short URL

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
    state.dataVersion = (state.dataVersion || 0) + 1;
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
    // Create/reuse a short code for this token
    let code = [...shortToToken.entries()].find(([,t]) => t === token)?.[0];
    if (!code) {
        code = crypto.randomBytes(4).toString('hex'); // 8-char hex e.g. "a3f9c12b"
        shortToToken.set(code, token);
    }
    const host = getHost();
    return `${host}/go/${code}`;
}

/** Also expose the raw token (for showing in WhatsApp without full URL) */
function getRawToken(number) {
    if (!numberToToken.has(number)) generateToken(number); // ensure created
    return numberToToken.get(number);
}

/** Revoke a number's token (e.g. removed from whitelist) */
function revokeToken(number) {
    const token = numberToToken.get(number);
    if (token) {
        tokenToNumber.delete(token);
        // Remove associated short code
        for (const [code, t] of shortToToken) {
            if (t === token) { shortToToken.delete(code); break; }
        }
    }
    numberToToken.delete(number);
}

/**
 * Returns a human-friendly short URL (via is.gd) for the number's dashboard link.
 * Result is cached — is.gd is only called once per code.
 * Falls back to the /go/:code URL if the service is unavailable.
 */
async function generateShortLink(number) {
    // Ensure token + short code exist
    const longUrl = generateToken(number);           // e.g. http://65.x.x.x:3001/go/a3f9c12b
    const code    = [...shortToToken.entries()].find(([,t]) => t === numberToToken.get(number))?.[0];

    if (code && shortUrlCache.has(code)) return shortUrlCache.get(code);

    try {
        const target = encodeURIComponent(longUrl);
        const apiUrl = `https://is.gd/create.php?format=simple&url=${target}`;
        const resp   = await fetch(apiUrl, { signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
            const short = (await resp.text()).trim();
            if (short.startsWith('http')) {
                if (code) shortUrlCache.set(code, short);
                return short;
            }
        }
    } catch { /* network error or timeout — fall back silently */ }

    return longUrl; // fallback: still works, just shows IP
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
        dataVersion:  state.dataVersion || 0,
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

// Wire spreadsheet editor
createEditorRouter(app, requireSession);

// GET /go/:code  — short link, resolves to full token then logs in
app.get('/go/:code', (req, res) => {
    const token = shortToToken.get(req.params.code || '');
    if (!token) return res.redirect('/login?error=invalid');
    const number = validateToken(token);
    if (!number) return res.redirect('/login?error=invalid');
    const sid = createSession(number);
    res.setHeader('Set-Cookie', `dsid=${sid}; HttpOnly; Path=/; Max-Age=${30 * 24 * 3600}`);
    res.redirect('/');
});

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


// ── POST /send-code ──────────────────────────────────────────────────────────
app.post('/send-code', (req, res) => {  // no session required — IP rate-limited
    _cleanOtps();
    // IP-based rate limit: max 3 OTP requests per IP per 10 minutes
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const ipKey = `ip:${ip}`;
    const ipEntry = otpStore.get(ipKey);
    if (ipEntry) {
        if (ipEntry.count >= 3 && Date.now() - ipEntry.start < 10 * 60_000) {
            return res.json({ ok: false, error: 'Too many requests from this IP. Try again later.' });
        }
        if (Date.now() - ipEntry.start >= 10 * 60_000) {
            otpStore.delete(ipKey);
        } else {
            ipEntry.count++;
        }
    } else {
        otpStore.set(ipKey, { count: 1, start: Date.now() });
    }
    const phone = (req.body.phone || '').replace(/\D/g,'').trim();
    if (!phone) return res.json({ ok: false, error: 'Phone number required.' });
    const whitelist = state.whitelist || [];
    if (!whitelist.includes(phone)) return res.json({ ok: false, error: 'Number not in whitelist.' });
    if (!_waClient || !_waClient.info) return res.json({ ok: false, error: 'Bot not connected.' });
    const existing = otpStore.get(phone);
    if (existing && Date.now() - existing.lastSent < 60_000) {
        const wait = Math.ceil((60_000 - (Date.now() - existing.lastSent)) / 1000);
        return res.json({ ok: false, error: `Wait ${wait}s before requesting another code.` });
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(phone, { code, expires: Date.now() + 5*60_000, attempts: 0, lastSent: Date.now() });
    _waClient.sendMessage(`${phone}@c.us`,
        `🔐 *Saving Bot Dashboard*\n\nYour login code:\n\n*${code}*\n\n⏱ Expires in 5 minutes.\nDo not share this code.`
    ).then(() => {
        console.log(`🔐 OTP sent to ${phone}`);
        res.json({ ok: true, message: `Code sent to ···${phone.slice(-4)}` });
    }).catch(err => {
        otpStore.delete(phone);
        res.json({ ok: false, error: 'Failed to send WhatsApp message.' });
    });
});

// ── POST /verify-code ─────────────────────────────────────────────────────────
app.post('/verify-code', (req, res) => {
    _cleanOtps();
    const phone = (req.body.phone || '').replace(/\D/g,'').trim();
    const code  = (req.body.code  || '').trim();
    const next  = (req.body.next  || '/');
    const entry = otpStore.get(phone);
    if (!entry) return res.json({ ok: false, error: 'Code expired. Request a new one.' });
    if (Date.now() > entry.expires) { otpStore.delete(phone); return res.json({ ok: false, error: 'Code expired.' }); }
    entry.attempts++;
    if (entry.attempts > 3) { otpStore.delete(phone); return res.json({ ok: false, error: 'Too many attempts. Request a new code.' }); }
    if (entry.code !== code) return res.json({ ok: false, error: `Incorrect code. ${4 - entry.attempts} attempt(s) left.` });
    otpStore.delete(phone);
    const sid = createSession(phone);
    res.setHeader('Set-Cookie', `dsid=${sid}; HttpOnly; Path=/; Max-Age=${30*24*3600}`);
    res.json({ ok: true, redirect: next.startsWith('/') ? next : '/' });
});

// ── GET /api/otp-status ───────────────────────────────────────────────────────
app.get('/api/otp-status', requireSession, (req, res) => {
    res.json({ botConnected: !!(_waClient && _waClient.info) });
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

// Live year report (protected) — same output as Export HTML Report → Year Overview
app.get('/report', requireSession, async (_, res) => {
    try {
        const { generateYearHtml } = require('./excel');
        const html = await generateYearHtml();
        res.send(html);
    } catch (err) {
        res.status(500).send(`<pre style="color:red">Report error: ${err.message}</pre>`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// HTML — LOGIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

function loginPage(error, next) {
    const errHtml = error === 'invalid'
        ? `<div class="msg err">❌ Invalid or expired token.</div>` : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saving Bot · Sign In</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
     background:#0a0f1e;color:#e2e8f0;min-height:100vh;
     display:flex;align-items:center;justify-content:center;padding:24px}
body::before{content:'';position:fixed;inset:0;pointer-events:none;
  background:radial-gradient(ellipse 80% 60% at 50% -5%,rgba(15,48,96,.8) 0%,transparent 65%),
             radial-gradient(ellipse 30% 25% at 80% 80%,rgba(15,118,110,.1) 0%,transparent 60%)}
.wrap{position:relative;z-index:1;width:100%;max-width:420px}
.brand{text-align:center;margin-bottom:24px}
.brand .icon{font-size:44px;display:block;margin-bottom:10px;
  filter:drop-shadow(0 0 20px rgba(15,118,110,.5))}
.brand h1{font-size:22px;font-weight:800;letter-spacing:-.4px;
  background:linear-gradient(135deg,#e2e8f0 30%,#94d5cd);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent}
.brand p{color:#374151;font-size:12px;margin-top:6px}
.card{background:rgba(17,24,39,.7);border:1px solid rgba(255,255,255,.08);
      border-radius:18px;overflow:hidden;backdrop-filter:blur(24px);
      box-shadow:0 24px 64px rgba(0,0,0,.5)}
/* Tabs */
.tabs{display:flex;border-bottom:1px solid rgba(255,255,255,.06)}
.tab{flex:1;padding:13px 8px;font-size:12px;font-weight:600;text-align:center;
     cursor:pointer;color:#4b5563;background:transparent;border:none;
     border-bottom:2px solid transparent;transition:all .2s;letter-spacing:.3px}
.tab:hover:not(.active){color:#94a3b8}
.tab.active{color:#4ade80;border-bottom-color:#4ade80;background:rgba(74,222,128,.04)}
/* Panels */
.panel{display:none;padding:28px}
.panel.active{display:block}
/* Form elements */
.field{margin-bottom:16px}
label{display:block;font-size:10px;color:#64748b;text-transform:uppercase;
      letter-spacing:.8px;font-weight:600;margin-bottom:7px}
input{width:100%;background:#111827;border:1px solid rgba(255,255,255,.09);
      border-radius:10px;padding:12px 14px;color:#e2e8f0;
      font-family:inherit;font-size:13px;outline:none;transition:border-color .2s}
input:focus{border-color:#0f766e;box-shadow:0 0 0 3px rgba(15,118,110,.12)}
input::placeholder{color:#1f2937}
.btn{width:100%;border:none;border-radius:10px;padding:13px;color:#fff;
     font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;letter-spacing:.02em}
.btn-primary{background:linear-gradient(135deg,#0f766e,#0c5a96)}
.btn-primary:hover{opacity:.88;transform:translateY(-1px)}
.btn-outline{background:rgba(15,118,110,.1);border:1px solid rgba(15,118,110,.3);
             color:#4ade80;margin-bottom:10px}
.btn-outline:hover{background:rgba(15,118,110,.2)}
.btn:disabled{opacity:.38;cursor:not-allowed;transform:none!important}
/* Messages */
.msg{border-radius:9px;padding:10px 13px;font-size:12px;margin-bottom:16px;line-height:1.5}
.msg.err{background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);color:#fca5a5}
.msg.ok{background:rgba(74,222,128,.07);border:1px solid rgba(74,222,128,.18);color:#86efac}
.msg.info{background:rgba(96,165,250,.07);border:1px solid rgba(96,165,250,.18);color:#93c5fd}
/* Code input */
.code-wrap{display:flex;gap:8px;align-items:center;margin-bottom:12px}
.code-wrap input{flex:1;text-align:center;font-size:22px;letter-spacing:.3em;font-weight:700;
                 font-family:'Courier New',monospace}
.resend-btn{background:transparent;border:1px solid #1e293b;border-radius:8px;
            color:#64748b;padding:10px 12px;font-size:11px;cursor:pointer;
            white-space:nowrap;flex-shrink:0;transition:all .2s}
.resend-btn:hover:not(:disabled){border-color:#0f766e;color:#4ade80}
.resend-btn:disabled{opacity:.5;cursor:not-allowed}
.hint{text-align:center;font-size:11px;color:#374151;margin-top:16px;line-height:1.8}
.hint a{color:#0f766e;text-decoration:none}
.phone-note{font-size:10px;color:#374151;margin-top:-11px;margin-bottom:14px;padding-left:2px}
.divider{display:flex;align-items:center;gap:10px;margin:18px 0}
.divider::before,.divider::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.06)}
.divider span{color:#374151;font-size:10px;letter-spacing:.5px}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">
    <span class="icon">💰</span>
    <h1>Saving Bot</h1>
    <p>Live Financial Dashboard</p>
  </div>

  <div class="card">
    <!-- Tabs -->
    <div class="tabs">
      <button class="tab active" onclick="switchTab('token')">🔑&nbsp; Access Token</button>
      <button class="tab"        onclick="switchTab('otp')">📱&nbsp; WhatsApp Code</button>
    </div>

    <!-- ── Token panel ──────────────────────────────────────────────── -->
    <div class="panel active" id="panel-token">
      ${errHtml}
      <form method="POST" action="/login" autocomplete="off">
        <input type="hidden" name="next" value="${next || '/'}">
        <div class="field">
          <label>Access Token</label>
          <input type="text" name="token" id="tokenInput"
                 placeholder="Paste your token here…"
                 autocomplete="off" autocorrect="off" spellcheck="false">
        </div>
        <button class="btn btn-primary" type="submit">Sign In →</button>
      </form>
      <p class="hint">
        Don't have a token?<br>
        Send <a href="#">Preview Dashboard</a> on WhatsApp to get one,<br>
        or use the <strong>WhatsApp Code</strong> tab.
      </p>
    </div>

    <!-- ── OTP panel ────────────────────────────────────────────────── -->
    <div class="panel" id="panel-otp">
      <div id="otp-msg"></div>

      <!-- Step 1 — always visible -->
      <div id="step1">
        <div class="field">
          <label>Your whitelisted phone number</label>
          <input type="tel" id="otp-phone" inputmode="numeric"
                 placeholder="e.g. 923111234567"
                 autocomplete="off">
          <p class="phone-note">Include country code, no spaces or + symbol</p>
        </div>
        <button class="btn btn-outline" id="send-btn" onclick="sendCode()">
          📤 Send Code via WhatsApp
        </button>
      </div>

      <!-- Step 2 — appears after code is sent, stays visible -->
      <div id="step2-wrap" style="display:none">
        <div class="divider"><span>ENTER CODE</span></div>
        <div class="field">
          <label>6-digit code from WhatsApp</label>
          <div class="code-wrap">
            <input type="number" id="otp-code" inputmode="numeric"
                   maxlength="6" placeholder="• • • • • •"
                   autocomplete="one-time-code">
            <button class="resend-btn" id="resend-btn" disabled onclick="handleResend()">
              <span id="resend-label">60s</span>
            </button>
          </div>
        </div>
        <button class="btn btn-primary" onclick="verifyCode()">Verify &amp; Sign In →</button>
      </div>

      <p class="hint">Only <a href="#">whitelisted numbers</a> can receive a code.</p>
    </div>
  </div>
</div>

<script>
var NEXT = ${JSON.stringify(next || '/')};
var otpPhone = '';
var resendTimer = null;

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(function(t, i) {
    t.classList.toggle('active', (tab === 'token') ? i === 0 : i === 1);
  });
  document.getElementById('panel-token').classList.toggle('active', tab === 'token');
  document.getElementById('panel-otp').classList.toggle('active', tab === 'otp');
  if (tab === 'token') document.getElementById('tokenInput').focus();
  if (tab === 'otp')   document.getElementById('otp-phone').focus();
}

// ── Message helper ────────────────────────────────────────────────────────────
function showMsg(text, type) {
  var el = document.getElementById('otp-msg');
  el.innerHTML = text
    ? '<div class="msg ' + type + '">' + text + '</div>'
    : '';
}

// ── Send OTP ──────────────────────────────────────────────────────────────────
async function sendCode() {
  var phone = (document.getElementById('otp-phone').value || '')
                .replace(/\D/g, '').trim();
  if (phone.length < 7) { showMsg('Enter a valid phone number.', 'err'); return; }
  var btn = document.getElementById('send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  showMsg('', '');
  try {
    var r = await fetch('/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phone })
    });
    var d = await r.json();
    if (d.ok) {
      otpPhone = phone;
      showMsg('✅ ' + d.message + '. Enter the code below.', 'ok');
      document.getElementById('step2-wrap').style.display = '';
      document.getElementById('otp-code').focus();
      btn.textContent = '📤 Resend Code';
      startResendCountdown();
    } else {
      showMsg('❌ ' + d.error, 'err');
      btn.disabled = false;
      btn.textContent = '📤 Send Code via WhatsApp';
    }
  } catch(e) {
    showMsg('❌ Network error — try again.', 'err');
    btn.disabled = false;
    btn.textContent = '📤 Send Code via WhatsApp';
  }
}

// ── Verify OTP ────────────────────────────────────────────────────────────────
async function verifyCode() {
  var code = (document.getElementById('otp-code').value || '').trim();
  if (code.length !== 6) { showMsg('Enter the 6-digit code.', 'err'); return; }
  showMsg('Verifying…', 'info');
  try {
    var r = await fetch('/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: otpPhone, code: code, next: NEXT })
    });
    var d = await r.json();
    if (d.ok) {
      showMsg('✅ Verified! Redirecting…', 'ok');
      window.location.href = d.redirect || '/';
    } else {
      showMsg('❌ ' + d.error, 'err');
    }
  } catch(e) {
    showMsg('❌ Network error — try again.', 'err');
  }
}

// ── Resend countdown (60s) ────────────────────────────────────────────────────
function startResendCountdown() {
  clearInterval(resendTimer);
  var rb = document.getElementById('resend-btn');
  var rl = document.getElementById('resend-label');
  rb.disabled = true;
  var t = 60;
  rl.textContent = t + 's';
  resendTimer = setInterval(function() {
    t--;
    if (t <= 0) {
      clearInterval(resendTimer);
      rb.disabled = false;
      rl.textContent = 'Resend';
    } else {
      rl.textContent = t + 's';
    }
  }, 1000);
}

function handleResend() {
  var rb = document.getElementById('resend-btn');
  rb.disabled = true;
  document.getElementById('resend-label').textContent = '…';
  document.getElementById('send-btn').click();
}

// ── Enter key ─────────────────────────────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  var otpActive = document.getElementById('panel-otp').classList.contains('active');
  if (!otpActive) return;
  var step2Visible = document.getElementById('step2-wrap').style.display !== 'none';
  if (document.activeElement === document.getElementById('otp-phone') || !step2Visible) {
    sendCode();
  } else {
    verifyCode();
  }
});

// Auto-focus
document.getElementById('tokenInput').focus();
</script>
</body>
</html>`;
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
  --grad1:#0f3460;--grad2:#0f766e15;
  --header-bg:rgba(10,15,30,.85);
}
[data-theme="light"]{
  --bg:#f1f5f9;--surface:#ffffff;--surface2:#f8fafc;--border:rgba(0,0,0,.08);
  --text:#1e293b;--muted:#64748b;--accent:#0f766e;--accent2:#1e40af;
  --green:#16a34a;--red:#dc2626;--blue:#2563eb;--yellow:#d97706;
  --grad1:#e0f2fe;--grad2:#d1fae522;
  --header-bg:rgba(255,255,255,.9);
}
body{font-family:'DM Mono',monospace;background:var(--bg);color:var(--text);min-height:100vh;font-size:13px;transition:background .3s,color .3s}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(ellipse 70% 50% at 50% -10%,var(--grad1) 0%,transparent 70%),
             radial-gradient(ellipse 30% 30% at 90% 90%,var(--grad2) 0%,transparent 60%)}
.header{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;
  padding:14px 20px;border-bottom:1px solid var(--border);
  background:var(--header-bg);backdrop-filter:blur(16px)}
.header h1{font-family:'Syne',sans-serif;font-size:16px;font-weight:800;
  background:linear-gradient(135deg,#e2e8f0,#94d5cd);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
[data-theme="light"] .header h1{background:linear-gradient(135deg,#1e3a5f,#0f766e);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header .sub{font-size:11px;color:var(--muted);margin-top:2px}
.header-right{display:flex;align-items:center;gap:10px}
.theme-btn{background:var(--surface2);border:1px solid var(--border);color:var(--text);
  border-radius:20px;padding:5px 12px;font-size:13px;cursor:pointer;transition:all .2s}
.theme-btn:hover{border-color:var(--accent)}
.live-pill{display:flex;align-items:center;gap:6px;border-radius:20px;padding:5px 12px;font-size:11px;font-weight:500;
  background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.2);color:#4ade80}
.live-pill.offline{background:rgba(248,113,113,.08);border-color:rgba(248,113,113,.2);color:#f87171}
.live-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:blink 1.4s ease-in-out infinite}
.live-dot.offline{animation:none}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
.page{position:relative;z-index:1;padding:16px;max-width:900px;margin:0 auto}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:14px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;transition:border-color .2s,background .3s}
.stat:hover{border-color:rgba(255,255,255,.15)}
[data-theme="light"] .stat:hover{border-color:rgba(0,0,0,.15)}
.stat-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px}
.stat-value{font-family:'Syne',sans-serif;font-size:24px;font-weight:700;line-height:1}
.stat-sub{font-size:10px;color:var(--muted);margin-top:4px}
.v-green{color:var(--green)}.v-red{color:var(--red)}.v-blue{color:var(--blue)}.v-yellow{color:var(--yellow)}.v-white{color:var(--text)}
.block{background:var(--surface);border:1px solid var(--border);border-radius:14px;margin-bottom:12px;overflow:hidden;transition:background .3s}
.block-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--border)}
.block-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:700}
.block-badge{font-size:10px;color:var(--muted);background:var(--surface2);border-radius:6px;padding:2px 8px}
.block-body{padding:14px 16px}
.fin-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)}
.fin-row.fin-last{border:none}
.fin-label{color:var(--muted)}.fin-val{font-weight:500}
.fin-section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--accent);padding:10px 0 4px;margin-top:4px}
.fin-divider{border-top:1px solid var(--border);margin:6px 0}
.sched-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)}
.sched-row:last-child{border:none}
.sched-cron{font-size:11px;color:var(--accent);background:rgba(15,118,110,.1);border-radius:6px;padding:2px 8px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{background:rgba(15,118,110,.1);border:1px solid rgba(15,118,110,.25);color:#94d5cd;
  border-radius:20px;padding:4px 12px;font-size:11px;font-family:'DM Mono',monospace}
[data-theme="light"] .chip{color:#0f766e}
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
  <div class="header-right">
    <button class="theme-btn" id="theme-btn" onclick="toggleTheme()" title="Toggle theme">🌙</button>
    <div id="live-pill" class="live-pill offline">
      <span class="live-dot offline" id="live-dot"></span>
      <span id="live-label">Offline</span>
    </div>
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

  <!-- OTP Code Panel -->
  <div class="block">
    <div class="block-head"><span class="block-title">📱 Send Dashboard Code</span><span class="block-badge" id="otp-badge" style="background:rgba(15,118,110,.2);color:#4ade80">WhatsApp OTP</span></div>
    <div class="block-body" style="padding:14px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Send a 6-digit login code to any whitelisted number via WhatsApp.</div>
      <div id="otp-msg" style="margin-bottom:10px"></div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <input id="otp-dash-phone" type="tel" inputmode="numeric" placeholder="Phone number (e.g. 923111234567)"
               style="flex:1;background:#111827;border:1px solid #2d3f5e;border-radius:7px;padding:8px 10px;color:#e2e8f0;font-size:12px;outline:none;font-family:monospace"
               onkeydown="if(event.key==='Enter')sendDashOtp()">
        <button onclick="sendDashOtp()" id="otp-dash-btn"
                style="background:#0f766e;border:none;border-radius:7px;color:#fff;padding:8px 14px;font-size:12px;cursor:pointer;font-weight:600;white-space:nowrap">
          Send Code
        </button>
      </div>
      <div id="otp-code-row" style="display:none;gap:8px;align-items:center">
        <input id="otp-dash-code" type="number" inputmode="numeric" maxlength="6" placeholder="Enter 6-digit code"
               style="flex:1;background:#111827;border:1px solid #2d3f5e;border-radius:7px;padding:8px 10px;color:#e2e8f0;font-size:14px;font-weight:700;letter-spacing:.2em;text-align:center;outline:none;font-family:monospace;width:160px"
               onkeydown="if(event.key==='Enter')verifyDashOtp()">
        <button onclick="verifyDashOtp()" id="otp-verify-btn"
                style="background:#1e40af;border:none;border-radius:7px;color:#fff;padding:8px 14px;font-size:12px;cursor:pointer;font-weight:600;white-space:nowrap">
          Verify
        </button>
        <button onclick="resetOtpForm()"
                style="background:transparent;border:1px solid #374151;border-radius:7px;color:#64748b;padding:8px 10px;font-size:11px;cursor:pointer">
          ↩
        </button>
      </div>
    </div>
  </div>
  <div class="block">
    <div class="block-head">
      <span class="block-title">💰 Current Month Summary</span>
      <span class="block-badge" id="b-month-label">—</span>
    </div>
    <div class="block-body">
      <div class="fin-section-title">⚖️ Balance</div>
      <div class="fin-row"><span class="fin-label">💰 Budget Balance (Can Use)</span><span class="fin-val v-green" id="f-canUse">—</span></div>
      <div class="fin-row"><span class="fin-label">💳 Balance I Have Left</span><span class="fin-val" id="f-haveLeft">—</span></div>
      <div class="fin-row"><span class="fin-label">📊 Difference</span><span class="fin-val" id="f-diff">—</span></div>
      <div class="fin-divider"></div>
      <div class="fin-section-title">🏦 Bank</div>
      <div class="fin-row"><span class="fin-label">📈 Total Income</span><span class="fin-val v-green" id="f-income">—</span></div>
      <div class="fin-row"><span class="fin-label">📉 Total Expenses</span><span class="fin-val v-red" id="f-expenses">—</span></div>
      <div class="fin-row"><span class="fin-label">⚖️ Net</span><span class="fin-val" id="f-net">—</span></div>
      <div class="fin-divider"></div>
      <div class="fin-section-title">💵 Petty Cash</div>
      <div class="fin-row"><span class="fin-label">Available</span><span class="fin-val v-blue" id="f-pcAvail">—</span></div>
      <div class="fin-row"><span class="fin-label">Used</span><span class="fin-val v-red" id="f-pcUsed">—</span></div>
      <div class="fin-row fin-last"><span class="fin-label">Left</span><span class="fin-val" id="f-pcLeft">—</span></div>
    </div>
  </div>

  <div class="block" style="overflow:hidden">
    <div class="block-head">
      <span class="block-title">📊 Year Report</span>
      <div style="display:flex;align-items:center;gap:8px">
        <span id="rpt-status" style="font-size:10px;color:var(--muted)">Loading…</span>
        <button onclick="loadReport(true)"
          style="background:rgba(15,118,110,.15);border:1px solid rgba(15,118,110,.3);color:#94d5cd;
          border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:inherit">
          ↺ Refresh
        </button>
      </div>
    </div>
    <div id="rpt-host" style="width:100%;min-height:80vh;background:var(--surface);border-radius:0 0 14px 14px;overflow:auto"></div>
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
    // Top stat cards
    document.getElementById('s-budget').textContent=N(ms.balanceCanUse);
    const le=document.getElementById('s-left');
    le.textContent=N(ms.balanceHaveLeft);
    le.className='stat-value '+col(ms.balanceHaveLeft||0);
    // Month label
    document.getElementById('b-month-label').textContent=ms.month||'—';
    // Balance section — individual targeted updates
    document.getElementById('f-canUse').textContent   = N(ms.balanceCanUse);
    const hl=document.getElementById('f-haveLeft');
    hl.textContent=N(ms.balanceHaveLeft); hl.className='fin-val '+col(ms.balanceHaveLeft||0);
    const df=document.getElementById('f-diff');
    df.textContent=(diff>=0?'+':'')+N(diff); df.className='fin-val '+col(diff);
    // Bank section
    document.getElementById('f-income').textContent   = N(ms.totalIncome);
    document.getElementById('f-expenses').textContent = N(ms.totalExpenses);
    const nt=document.getElementById('f-net');
    nt.textContent=(ms.net>=0?'+':'')+N(ms.net); nt.className='fin-val '+col(ms.net||0);
    // Petty cash section
    document.getElementById('f-pcAvail').textContent = N(ms.pettyCashAvailable);
    document.getElementById('f-pcUsed').textContent  = N(ms.pettyCashUsed);
    const pl=document.getElementById('f-pcLeft');
    pl.textContent=N(ms.pettyCashLeft); pl.className='fin-val '+col(ms.pettyCashLeft||0);
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
// ── Theme ──────────────────────────────────────────────────────────────────
const REPORT_DARK_CSS=\`
body{background:#0a0f1e!important;color:#e2e8f0!important}
.sum-box,.viz-card,.year-summary,.breakdown-section,.bb-section,.main-tabs,.month-tab-bar{background:#1e293b!important;color:#e2e8f0!important}
.sum-box-featured{background:linear-gradient(135deg,#0f3460 0%,#0f2a1e 100%)!important;border-color:#0f766e!important}
.tab-btn{background:#1e293b!important;border-color:rgba(255,255,255,.12)!important;color:#94a3b8!important}
.tab-btn.active{background:#0f766e!important;border-color:#0f766e!important;color:#fff!important}
.main-tab-btn{color:#94a3b8!important}
.main-tab-btn.active{color:#4ade80!important;border-bottom-color:#4ade80!important}
.main-tabs{background:#111827!important;border-bottom-color:rgba(255,255,255,.07)!important}
.month-tab-bar{border-bottom-color:rgba(255,255,255,.07)!important}
table{background:#1e293b!important}
tr{background:#1e293b!important}
td{background:#1e293b!important;border-bottom-color:rgba(255,255,255,.06)!important;color:#e2e8f0!important}
th{background:#0f3460!important;color:#e2e8f0!important}
tfoot td{background:#111827!important}
.breakdown-table th,.breakdown-table th.cat-col{background:#111827!important;color:#94a3b8!important;border-bottom-color:rgba(255,255,255,.08)!important}
.breakdown-table th.total-col{background:#0f1f3a!important}
.cat-name{background:#1e293b!important;color:#e2e8f0!important}
.total-cell{background:#111827!important}
.tpd-total-row td{background:#0d2017!important;border-top-color:rgba(15,118,110,.25)!important}
.tpd-total-row .cat-name{background:#0d2017!important;color:#4ade80!important}
.tpd-row-label{color:#94a3b8!important}
.tpd-val{color:#4ade80!important}
.tpd-bank{color:#60a5fa!important}
.tpd-petty{color:#c084fc!important}
.bb-head-month,.bb-head-num,.bb-head-status{background:#111827!important;border-bottom-color:rgba(255,255,255,.08)!important;color:#94a3b8!important}
.bb-head-can{background:#0a2218!important;color:#4ade80!important}
.bb-head-left{background:#0a1535!important;color:#60a5fa!important}
.bb-month{background:#1e293b!important;color:#e2e8f0!important;border-bottom-color:rgba(255,255,255,.06)!important}
.bb-num{background:#1e293b!important;border-bottom-color:rgba(255,255,255,.06)!important}
.bb-can{background:rgba(15,118,110,.12)!important}
.bb-left{background:rgba(30,64,175,.12)!important}
.bb-status{background:#1e293b!important}
.bb-mini{background:linear-gradient(135deg,#0f3460 0%,#0a2218 100%)!important;border-color:#0f766e!important}
.bb-mini-row{border-bottom-color:rgba(15,118,110,.15)!important}
.bb-mini-label{color:#94a3b8!important}
.sum-row{border-bottom-color:rgba(255,255,255,.06)!important}
.sum-label{color:#94a3b8!important}
.sum-box-title{color:#e2e8f0!important}
.section-title,.viz-title{color:#94d5cd!important}
.viz-subtitle{color:#64748b!important}
.section-wrap,.viz-wrap{color:#e2e8f0!important}
.footer{background:#0a0f1e!important;color:#4b5563!important}
.pill-good{background:#052e16!important;color:#4ade80!important}
.pill-warn{background:#1c1400!important;color:#fbbf24!important}
.pill-low{background:#1c0505!important;color:#f87171!important}
.empty,.empty-row,.empty-cell{color:#4b5563!important}
.sec-total{color:#94a3b8!important}
.bb-income{color:#4ade80!important}
.bb-expense{color:#f87171!important}
\`;

function isDark(){return document.documentElement.getAttribute('data-theme')!=='light'}

function applyReportTheme(){
  const host=document.getElementById('rpt-host');
  if(!host)return;
  // Must be appended LAST so it wins the cascade over report's own styles
  let el=host.querySelector('#rpt-theme-override');
  if(el)el.remove();
  el=document.createElement('style');
  el.id='rpt-theme-override';
  host.appendChild(el);
  el.textContent=isDark()?REPORT_DARK_CSS:'';
}

function toggleTheme(){
  const isLight=isDark();
  document.documentElement.setAttribute('data-theme',isLight?'light':'dark');
  document.getElementById('theme-btn').textContent=isLight?'🌙':'☀️';
  localStorage.setItem('dash-theme',isLight?'light':'dark');
  applyReportTheme();
}

// Init theme — default dark
(function(){
  const saved=localStorage.getItem('dash-theme')||'dark';
  document.documentElement.setAttribute('data-theme',saved);
  document.addEventListener('DOMContentLoaded',()=>{
    const btn=document.getElementById('theme-btn');
    if(btn)btn.textContent=saved==='light'?'☀️':'🌙';
  });
})();

function showToast(msg){
  const t=document.createElement('div');
  t.textContent=msg;
  t.style.cssText='position:fixed;bottom:24px;right:24px;background:#0f766e;color:white;padding:10px 18px;border-radius:10px;font-size:13px;z-index:999;opacity:0;transition:opacity .3s;font-family:inherit';
  document.body.appendChild(t);
  requestAnimationFrame(()=>{t.style.opacity='1';setTimeout(()=>{t.style.opacity='0';setTimeout(()=>t.remove(),400)},3000)});
}

// Embed report directly into page DOM and re-execute its scripts so tabs work
let reportLoading=false;
async function loadReport(manual=false){
  if(reportLoading)return;
  reportLoading=true;
  const status=document.getElementById('rpt-status');
  if(status)status.textContent='Updating…';
  try{
    const html=await fetch('/report?t='+Date.now()).then(r=>r.text());
    const host=document.getElementById('rpt-host');
    const parser=new DOMParser();
    const doc=parser.parseFromString(html,'text/html');

    // Clear previous content
    host.innerHTML='';

    // Inject scoped styles
    doc.querySelectorAll('style').forEach(s=>{
      const el=document.createElement('style');
      el.textContent=s.textContent;
      host.appendChild(el);
    });

    // Inject body content
    const wrap=document.createElement('div');
    wrap.innerHTML=doc.body.innerHTML;
    host.appendChild(wrap);

    // Re-execute scripts so tab handlers and all JS work
    doc.querySelectorAll('script').forEach(old=>{
      const s=document.createElement('script');
      s.textContent=old.textContent;
      host.appendChild(s);
    });

    if(status)status.textContent='Live ●';
    applyReportTheme();
    if(manual)showToast('📊 Report refreshed');
  }catch(e){
    if(status)status.textContent='Error';
    console.error('Report load error:',e);
  }finally{
    reportLoading=false;
  }
}
loadReport();

const es=new EventSource('/events');
let lastDataVersion=null;
es.onmessage=e=>{try{
  const d=JSON.parse(e.data);
  render(d);
  if(lastDataVersion!==null&&d.dataVersion!==lastDataVersion){
    loadReport();
    showToast('💰 Data updated');
  }
  lastDataVersion=d.dataVersion;
}catch(_){}};
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
    server = app.listen(PORT, async () => {
        if (!detectedHost) {
            const ip = await detectPublicIp();
            if (ip) {
                detectedHost = `http://${ip}:${PORT}`;
                console.log(`📊 Dashboard live → ${detectedHost}`);
            } else {
                console.log(`📊 Dashboard live → port ${PORT} (could not detect public IP)`);
            }
        } else {
            console.log(`📊 Dashboard live → ${detectedHost}`);
        }
    });
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
    startDashboard, stopDashboard, isRunning, setClient,
    generateToken,  generateShortLink, getRawToken, revokeToken,
    setBotOnline,   setWhitelist,  setSchedules,
    setMonthSummary, logActivity,
};