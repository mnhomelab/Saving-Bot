'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// EDITOR — OnlyOffice Document Server integration
//
// Routes (session-protected):
//   GET  /edit                       → file picker page
//   GET  /edit/open?file=xxx.xlsx    → full-screen OnlyOffice editor
//   GET  /api/edit/files             → list xlsx files in Saving-Year/
//   GET  /api/edit/config?file=xxx   → OnlyOffice document config JSON
//   GET  /api/edit/backups?file=xxx  → list backups for a file
//   GET  /api/edit/backup-download?name=xxx → download a backup
//
// Routes (secret-token-protected — called by OnlyOffice DS, not the browser):
//   GET  /api/edit/serve/:file?secret=xxx  → stream xlsx to OnlyOffice DS
//   POST /api/edit/callback?file=xxx&secret=xxx → OnlyOffice save/status hook
//
// Required .env vars:
//   ONLYOFFICE_DS_URL      URL the BROWSER uses to reach Document Server
//                          e.g. http://YOUR_SERVER_IP:8080
//   BOT_CALLBACK_HOST      URL OnlyOffice DS uses to reach THIS bot
//                          e.g. http://saving-bot-v1.0:3001  (Docker container name)
//   ONLYOFFICE_SECRET      Shared secret for serve/callback security
//                          (auto-derived if not set, but set it explicitly in prod)
// ─────────────────────────────────────────────────────────────────────────────

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const https  = require('https');
const { YEAR_FOLDER } = require('../config');

// ── Auto-detect public IP (used as fallback for ONLYOFFICE_DS_URL) ────────────
let _detectedIp = null;

function detectPublicIp() {
    return new Promise(resolve => {
        https.get('https://api.ipify.org', res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => resolve(d.trim()));
        }).on('error', () => resolve(null));
    });
}

// Kick off detection immediately at module load; result cached in _detectedIp
detectPublicIp().then(ip => {
    if (ip) {
        _detectedIp = ip;
        console.log(`🌐 Editor: detected public IP → ${ip}`);
    } else {
        console.warn('⚠️  Editor: could not detect public IP — set ONLYOFFICE_DS_URL in .env');
    }
});

function getDsUrl() {
    const env = (process.env.ONLYOFFICE_DS_URL || '').replace(/\/$/, '');
    // If env var is set AND doesn't contain the placeholder, use it as-is
    if (env && !env.includes('YOUR_SERVER_IP')) return env;
    // Fall back to auto-detected public IP (populated at startup)
    if (_detectedIp) return `http://${_detectedIp}:8080`;
    return 'http://localhost:8080';
}

// ── Bot callback URL resolver ─────────────────────────────────────────────────
// OnlyOffice DS calls this URL to download the xlsx and post save events.
// If BOT_CALLBACK_HOST contains the placeholder (or is unset), auto-substitute
// the detected public IP — same pattern as getDsUrl().
// NOTE: avoid container names with dots (e.g. saving-bot-v1.0) — Docker DNS
// misparses them. Use the dot-free alias 'savingbot' or the public IP instead.
function getBotUrl() {
    const env  = (process.env.BOT_CALLBACK_HOST || '').replace(/\/$/, '');
    const port = process.env.DASHBOARD_PORT || 3001;
    if (env && !env.includes('YOUR_SERVER_IP') && !env.includes('saving-bot-v1.0'))
        return env;
    if (_detectedIp) return `http://${_detectedIp}:${port}`;
    return `http://localhost:${port}`;
}

// ── JWT signing for OnlyOffice DS ─────────────────────────────────────────────
// OnlyOffice 8+ has JWT enabled by default. Sign the config if the secret is set.
// Set ONLYOFFICE_JWT_SECRET in .env to match JWT_SECRET in docker-compose.
function jwtSign(payload) {
    const secret = process.env.ONLYOFFICE_JWT_SECRET;
    if (!secret) return null;
    try {
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const body   = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const sig    = crypto.createHmac('sha256', secret)
            .update(`${header}.${body}`)
            .digest('base64url');
        return `${header}.${body}.${sig}`;
    } catch (e) {
        console.warn('⚠️  JWT signing failed:', e.message);
        return null;
    }
}

// ── Backup directory ──────────────────────────────────────────────────────────
const BACKUP_DIR = path.join(YEAR_FOLDER, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MAX_BACKUPS_PER_FILE = 20;

function createBackup(filePath) {
    try {
        const base = path.basename(filePath, '.xlsx');
        const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupName = `${base}_${ts}.xlsx`;
        fs.copyFileSync(filePath, path.join(BACKUP_DIR, backupName));

        const all = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith(base + '_') && f.endsWith('.xlsx'))
            .sort();
        if (all.length > MAX_BACKUPS_PER_FILE) {
            all.slice(0, all.length - MAX_BACKUPS_PER_FILE)
                .forEach(old => { try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch {} });
        }
        return backupName;
    } catch (e) {
        console.warn('⚠️  Backup failed (non-fatal):', e.message);
        return null;
    }
}

// ── Security secret ───────────────────────────────────────────────────────────
// Authenticates /api/edit/serve and /api/edit/callback requests from OnlyOffice DS
const SERVE_SECRET = process.env.ONLYOFFICE_SECRET
    || crypto.createHash('sha256')
        .update('saving-bot-oo-' + (process.env.DASHBOARD_PORT || '3001'))
        .digest('hex')
        .slice(0, 32);

// ── Document key ──────────────────────────────────────────────────────────────
// Must change whenever the file changes so OnlyOffice DS fetches a fresh copy.
function getDocKey(filePath) {
    try {
        const s = fs.statSync(filePath);
        return crypto.createHash('md5')
            .update(filePath + s.mtimeMs + s.size)
            .digest('hex')
            .slice(0, 20);
    } catch {
        return Date.now().toString(36);
    }
}

// ── Router factory ────────────────────────────────────────────────────────────
function createEditorRouter(app, requireSession) {

    // File picker
    app.get('/edit', requireSession, (req, res) => res.send(pickerHtml()));

    // OnlyOffice editor page
    app.get('/edit/open', requireSession, (req, res) => {
        const file = path.basename(req.query.file || '');
        if (!file || !file.endsWith('.xlsx')) return res.redirect('/edit');
        const filePath = path.join(YEAR_FOLDER, file);
        if (!fs.existsSync(filePath)) return res.redirect('/edit');
        res.send(editorPageHtml(file));
    });

    // List xlsx files
    app.get('/api/edit/files', requireSession, (req, res) => {
        try {
            const files = fs.readdirSync(YEAR_FOLDER)
                .filter(f => f.endsWith('.xlsx'))
                .sort().reverse()
                .map(f => {
                    const fp = path.join(YEAR_FOLDER, f);
                    const st = fs.statSync(fp);
                    const backups = (() => {
                        try {
                            return fs.readdirSync(BACKUP_DIR)
                                .filter(b => b.startsWith(f.replace('.xlsx','_'))).length;
                        } catch { return 0; }
                    })();
                    return { name: f, size: st.size, mtime: st.mtime, backups };
                });
            res.json({ ok: true, files });
        } catch { res.json({ ok: true, files: [] }); }
    });

    // OnlyOffice document config
    app.get('/api/edit/config', requireSession, (req, res) => {
        const file     = path.basename(req.query.file || '');
        const filePath = path.join(YEAR_FOLDER, file);
        if (!file || !fs.existsSync(filePath))
            return res.json({ ok: false, error: 'File not found' });

        const DS_URL  = getDsUrl();
        const BOT_URL = getBotUrl();
        console.log(`🔗 OO config → DS: ${DS_URL}  BOT: ${BOT_URL}`);

        const config = {
            document: {
                fileType: 'xlsx',
                key:   getDocKey(filePath),
                title: file,
                url:   `${BOT_URL}/api/edit/serve/${encodeURIComponent(file)}?secret=${SERVE_SECRET}`,
                permissions: { edit: true, download: true, print: true, review: false },
            },
            documentType: 'cell',
            editorConfig: {
                callbackUrl: `${BOT_URL}/api/edit/callback?file=${encodeURIComponent(file)}&secret=${SERVE_SECRET}`,
                mode: 'edit',
                lang: 'en',
                user: { id: 'admin', name: 'Admin' },
                customization: {
                    autosave:  true,
                    forcesave: true,
                    chat:      false,
                    help:      false,
                    feedback:  { visible: false },
                    logo:      { visible: false },
                    goback:    { url: '/edit', text: '← File Picker', requestClose: false },
                },
            },
        };

        // JWT signing — only active when ONLYOFFICE_JWT_SECRET is set in .env
        // (not needed when JWT is disabled via onlyoffice-local.json, which is the default)
        const token = jwtSign(config);
        if (token) config.token = token;

        res.json({ ok: true, config, dsUrl: DS_URL });

    });
    app.get('/api/edit/serve/:file', (req, res) => {
        if (req.query.secret !== SERVE_SECRET) {
            console.warn('⚠️  Unauthorized file serve attempt');
            return res.status(401).send('Unauthorized');
        }
        const file     = path.basename(req.params.file || '');
        const filePath = path.join(YEAR_FOLDER, file);
        if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
        console.log(`📤 Serving to OnlyOffice DS: ${file}`);
        res.download(filePath, file);
    });

    // OnlyOffice save callback (no session — uses SERVE_SECRET)
    // Status codes: 0=no doc  1=editing  2=save ready  3=save error
    //               4=closed no changes  6=force-saved  7=force-save error
    app.post('/api/edit/callback', async (req, res) => {
        if (req.query.secret !== SERVE_SECRET) {
            console.warn('⚠️  Unauthorized callback attempt');
            return res.status(401).json({ error: 1 });
        }

        const { status, url } = req.body || {};
        const file     = path.basename(req.query.file || '');
        const filePath = path.join(YEAR_FOLDER, file);

        console.log(`📝 OnlyOffice callback → file="${file}" status=${status}`);

        if ((status === 2 || status === 6) && url) {
            if (!fs.existsSync(filePath)) {
                console.error(`❌ Callback: target file not found: ${file}`);
                return res.json({ error: 1 });
            }
            try {
                const backupName = createBackup(filePath);
                console.log(`💾 Backup before save: ${backupName || '(failed)'}`);
                const resp = await fetch(url);
                if (!resp.ok) throw new Error(`DS download failed: ${resp.status} ${resp.statusText}`);
                const buf  = Buffer.from(await resp.arrayBuffer());
                fs.writeFileSync(filePath, buf);
                console.log(`✅ Saved: ${file} (${(buf.length / 1024).toFixed(1)} KB)`);
            } catch (e) {
                console.error(`❌ OnlyOffice save error: ${e.message}`);
                return res.json({ error: 1 });
            }
        }

        res.json({ error: 0 }); // OnlyOffice requires { error: 0 } on success
    });

    // List backups
    app.get('/api/edit/backups', requireSession, (req, res) => {
        const file = path.basename(req.query.file || '');
        if (!file) return res.json({ ok: false, error: 'No file specified' });
        try {
            const base    = file.replace(/\.xlsx$/i, '');
            const backups = fs.readdirSync(BACKUP_DIR)
                .filter(f => f.startsWith(base + '_') && f.endsWith('.xlsx'))
                .sort().reverse()
                .map(name => {
                    const stat = fs.statSync(path.join(BACKUP_DIR, name));
                    return { name, size: stat.size, mtime: stat.mtime };
                });
            res.json({ ok: true, backups });
        } catch (e) { res.json({ ok: false, error: e.message }); }
    });

    // Download a backup
    app.get('/api/edit/backup-download', requireSession, (req, res) => {
        const name = path.basename(req.query.name || '');
        if (!name) return res.status(400).send('No name');
        const fp = path.join(BACKUP_DIR, name);
        if (!fs.existsSync(fp)) return res.status(404).send('Not found');
        res.download(fp, name);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE PICKER PAGE
// ─────────────────────────────────────────────────────────────────────────────
function pickerHtml() { return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Open File · Saving Bot</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d1117;--surface:#161b22;--surface2:#1f2937;
  --border:#30363d;--text:#e6edf3;--muted:#7d8590;--muted2:#6e7681;
  --green:#26aa26;--navy:#6699d9;--red:#f87171;--amber:#ffc000;
}
[data-theme="light"]{
  --bg:#f0eeea;--surface:#ffffff;--surface2:#f4f2ee;
  --border:#c8c4bb;--text:#000;--muted:#6b6560;--muted2:#958f88;
  --green:#1f8c1f;--navy:#3a5d9c;--red:#c04e4e;--amber:#b8860b;
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:Calibri,'Segoe UI',Arial,sans-serif;transition:background .2s,color .2s}
.header{background:var(--surface);border-bottom:2px solid var(--border);padding:10px 20px;display:flex;align-items:center;gap:12px;box-shadow:0 1px 6px rgba(0,0,0,.15)}
.header-logo{font-size:20px}
.header-title{font-size:15px;font-weight:700;color:var(--green);flex:1}
.header-title small{color:var(--muted);font-weight:400;font-size:12px;margin-left:6px}
.btn{border:none;border-radius:5px;padding:6px 14px;font-size:12px;cursor:pointer;font-weight:600;font-family:inherit;transition:all .15s;text-decoration:none;display:inline-flex;align-items:center;gap:5px}
.btn-ghost{background:var(--surface2);color:var(--text);border:1px solid var(--border)}
.btn-ghost:hover{border-color:var(--navy);color:var(--navy)}
#themeBtn{background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:6px 12px;font-size:12px;cursor:pointer;font-family:inherit;color:var(--text)}
#themeBtn:hover{border-color:var(--navy)}
.banner{margin:16px 20px 0;border-radius:8px;padding:10px 16px;font-size:12px;display:flex;align-items:center;gap:8px;border:1px solid}
.banner.ok{background:rgba(38,170,38,.1);border-color:var(--green);color:var(--green)}
.banner.err{background:rgba(248,113,113,.1);border-color:var(--red);color:var(--red)}
.banner.info{background:rgba(125,133,144,.1);border-color:var(--border);color:var(--muted)}
.main{padding:20px;max-width:960px;margin:0 auto}
.sec-label{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:10px;transition:all .15s}
.card:hover{border-color:var(--navy);transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.2)}
.card-top{display:flex;align-items:flex-start;gap:12px}
.card-icon{font-size:32px;line-height:1;flex-shrink:0}
.card-name{font-size:14px;font-weight:700;color:var(--text);word-break:break-word;line-height:1.3}
.card-meta{font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:4px}
.card-meta span{display:flex;align-items:center;gap:6px}
.badge{background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:1px 6px;font-size:10px;color:var(--muted2);font-weight:600}
.card-btns{display:flex;gap:8px;margin-top:4px}
.btn-open{flex:1;background:var(--navy);color:#fff;border:none;border-radius:6px;padding:9px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;transition:opacity .15s;display:flex;align-items:center;justify-content:center;gap:6px}
.btn-open:hover{opacity:.88}
.btn-bk{background:var(--surface2);color:var(--muted);border:1px solid var(--border);border-radius:6px;padding:9px 12px;font-size:12px;cursor:pointer;font-family:inherit;transition:all .15s}
.btn-bk:hover{border-color:var(--navy);color:var(--navy)}
.state{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px;gap:12px;color:var(--muted);font-size:13px;text-align:center}
.spin{width:22px;height:22px;border:3px solid var(--border);border-top-color:var(--navy);border-radius:50%;animation:sp .7s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
/* Drawer */
.ov{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:100;display:none;align-items:flex-start;justify-content:flex-end;padding:60px 20px 0}
.ov.open{display:flex}
.drawer{background:var(--surface);border:1px solid var(--border);border-radius:10px;width:420px;max-height:72vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.35)}
.dh{padding:12px 16px;border-bottom:1px solid var(--border);background:var(--surface2);border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:space-between}
.dh h3{font-size:13px;font-weight:700;color:var(--navy);margin:0}
.dh button{background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;padding:0 4px;line-height:1}
.dh button:hover{color:var(--text)}
.db{overflow-y:auto;flex:1;padding:4px 0}
.db::-webkit-scrollbar{width:5px}
.db::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
.brow{display:flex;align-items:center;padding:8px 16px;gap:8px;border-bottom:1px solid var(--border);font-size:11px}
.brow:last-child{border-bottom:none}
.brow .bn{flex:1;color:var(--text);font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.brow .bm{color:var(--muted2);white-space:nowrap;font-size:10px}
.brow a{background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--navy);font-size:10px;padding:2px 8px;text-decoration:none;font-weight:600;white-space:nowrap}
.brow a:hover{border-color:var(--navy)}
.bempty{padding:24px;text-align:center;color:var(--muted);font-size:12px}
</style>
</head>
<body>
<div class="header">
  <span class="header-logo">📂</span>
  <span class="header-title">Open in OnlyOffice <small>Saving Bot</small></span>
  <button id="themeBtn" onclick="toggleTheme()">☀️ Light</button>
  <a href="/" class="btn btn-ghost">← Dashboard</a>
</div>

<div id="banner" class="banner info">
  <div class="spin" style="width:14px;height:14px;border-width:2px;flex-shrink:0"></div>
  Checking file list…
</div>

<div class="main">
  <div class="sec-label">Your Excel Files</div>
  <div id="grid" class="grid">
    <div class="state"><div class="spin"></div><div>Loading files…</div></div>
  </div>
</div>

<div class="ov" id="ov" onclick="if(event.target===this)closeDrawer()">
  <div class="drawer">
    <div class="dh"><h3 id="dTitle">🗂 Backups</h3><button onclick="closeDrawer()">✕</button></div>
    <div class="db" id="db"></div>
  </div>
</div>

<script>
let darkMode = true;
function toggleTheme(){
    darkMode=!darkMode;
    document.documentElement.setAttribute('data-theme',darkMode?'dark':'light');
    document.getElementById('themeBtn').textContent=darkMode?'☀️ Light':'🌙 Dark';
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtBytes(b){return b>1048576?(b/1048576).toFixed(1)+' MB':(b/1024).toFixed(1)+' KB';}
function fmtDate(d){return new Date(d).toLocaleString('en-PK',{timeZone:'Asia/Karachi',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});}

async function load(){
    const banner=document.getElementById('banner');
    const grid=document.getElementById('grid');
    try {
        const [fr, cr] = await Promise.all([
            fetch('/api/edit/files'),
            fetch('/api/edit/config?file=_probe')   // just to get dsUrl
        ]);
        const d  = await fr.json();
        const dc = await cr.json().catch(()=>({}));
        const dsUrl = dc.dsUrl || '';

        if(!d.ok||!d.files.length){
            grid.innerHTML='<div class="state"><div style="font-size:40px">📭</div><div>No xlsx files found in Saving-Year/</div></div>';
            banner.className='banner info';
            banner.innerHTML='📁 No files found. Create a year file via WhatsApp first.'
                + (dsUrl ? ' · <span style="opacity:.7">DS: '+esc(dsUrl)+'</span>' : '');
            return;
        }
        banner.className='banner ok';
        banner.innerHTML='✅ '+d.files.length+' file'+(d.files.length!==1?'s':'')+' found — click <strong>Open in OnlyOffice</strong> to edit'
            + (dsUrl ? ' &nbsp;·&nbsp; <span style="opacity:.75;font-size:11px">DS: '+esc(dsUrl)+'</span>' : '');
        grid.innerHTML=d.files.map(f=>\`
<div class="card">
  <div class="card-top">
    <div class="card-icon">📊</div>
    <div style="flex:1;min-width:0"><div class="card-name">\${esc(f.name)}</div></div>
  </div>
  <div class="card-meta">
    <span>💾 \${fmtBytes(f.size)}</span>
    <span>🕐 \${fmtDate(f.mtime)}</span>
    <span>🗂 <span class="badge">\${f.backups} backup\${f.backups!==1?'s':''}</span></span>
  </div>
  <div class="card-btns">
    <button class="btn-open" onclick="openFile('\${esc(f.name)}')">📝 Open in OnlyOffice</button>
    <button class="btn-bk" onclick="showBackups('\${esc(f.name)}')" title="Backups">🗂</button>
  </div>
</div>\`).join('');
    } catch(e){
        grid.innerHTML='<div class="state"><div style="font-size:36px">❌</div><div>Failed to load files</div></div>';
        banner.className='banner err';
        banner.innerHTML='❌ Could not reach bot API: '+e.message;
    }
}

function openFile(name){ window.location.href='/edit/open?file='+encodeURIComponent(name); }

async function showBackups(name){
    document.getElementById('dTitle').textContent='🗂 Backups — '+name;
    document.getElementById('db').innerHTML='<div class="bempty">Loading…</div>';
    document.getElementById('ov').classList.add('open');
    try {
        const r=await fetch('/api/edit/backups?file='+encodeURIComponent(name));
        const d=await r.json();
        const db=document.getElementById('db');
        if(!d.ok||!d.backups.length){db.innerHTML='<div class="bempty">No backups yet.<br>They are created automatically on every save.</div>';return;}
        db.innerHTML=d.backups.map(b=>\`
<div class="brow">
  <span class="bn" title="\${esc(b.name)}">\${esc(b.name)}</span>
  <span class="bm">\${(b.size/1024).toFixed(1)} KB · \${fmtDate(b.mtime)}</span>
  <a href="/api/edit/backup-download?name=\${encodeURIComponent(b.name)}" download>⬇ Download</a>
</div>\`).join('');
    } catch{ document.getElementById('db').innerHTML='<div class="bempty">Failed to load.</div>'; }
}
function closeDrawer(){ document.getElementById('ov').classList.remove('open'); }
load();
</script>
</body>
</html>`; }

// ─────────────────────────────────────────────────────────────────────────────
// ONLYOFFICE EDITOR PAGE
// ─────────────────────────────────────────────────────────────────────────────
function editorPageHtml(file) {
    const safeFile = file.replace(/'/g, "\\'");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${file.replace(/</g,'&lt;')} · OnlyOffice</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;background:#0d1117;font-family:Calibri,'Segoe UI',Arial,sans-serif}
#editor{width:100vw;height:100vh}
.err{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;
  gap:16px;color:#e6edf3;background:#0d1117;text-align:center;padding:20px}
.err h2{color:#f87171;font-size:20px}
.err p{color:#7d8590;font-size:13px;max-width:500px;line-height:1.6}
.err code{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px 16px;
  font-size:12px;color:#e6edf3;display:block;max-width:580px;text-align:left;
  white-space:pre-wrap;word-break:break-all;line-height:1.5}
.err a{color:#6699d9;text-decoration:none;padding:8px 20px;border:1px solid #6699d9;
  border-radius:6px;font-size:13px;margin-top:4px}
.err a:hover{background:rgba(102,153,217,.1)}
.loading{display:flex;flex-direction:column;align-items:center;justify-content:center;
  height:100vh;gap:14px;color:#7d8590;background:#0d1117}
.spin{width:32px;height:32px;border:3px solid #30363d;border-top-color:#26aa26;
  border-radius:50%;animation:sp .7s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="loading" id="loading">
  <div class="spin"></div>
  <div style="font-size:13px">Loading <strong>${file.replace(/</g,'&lt;')}</strong> in OnlyOffice…</div>
</div>
<div id="editor"></div>

<script>
(async function () {
    const file = '${safeFile}';

    function showErr(title, detail, hint) {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('editor').innerHTML =
            '<div class="err">' +
            '<div style="font-size:48px">❌</div>' +
            '<h2>' + title + '</h2>' +
            '<p>' + detail + '</p>' +
            (hint ? '<code>' + hint + '</code>' : '') +
            '<a href="/edit">← Back to File Picker</a>' +
            '</div>';
    }

    // 1. Fetch OnlyOffice config from bot API
    let config, dsUrl;
    try {
        const r = await fetch('/api/edit/config?file=' + encodeURIComponent(file));
        const d = await r.json();
        if (!d.ok) { showErr('Config error', d.error || 'Unknown', null); return; }
        config = d.config;
        dsUrl  = d.dsUrl;
    } catch (e) {
        showErr('Failed to load config', 'Could not reach the bot API.', e.message);
        return;
    }

    // 2. Dynamically load the OnlyOffice Document Server JS API
    const apiSrc = dsUrl.replace(/\\/$/, '') + '/web-apps/apps/api/documents/api.js';
    const loaded = await new Promise(resolve => {
        const s = document.createElement('script');
        s.src = apiSrc;
        s.onload  = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
    });

    if (!loaded || typeof DocsAPI === 'undefined') {
        showErr(
            'Cannot reach OnlyOffice Document Server',
            'The browser could not load the OnlyOffice API script. ' +
            'Make sure the Document Server is running and ONLYOFFICE_DS_URL is reachable from your browser.',
            'API URL tried:\\n' + apiSrc +
            '\\n\\nCheck docker logs:\\n  docker logs onlyoffice-ds\\n\\nVerify ONLYOFFICE_DS_URL in your .env'
        );
        return;
    }

    // 3. Launch editor
    document.getElementById('loading').style.display = 'none';
    new DocsAPI.DocEditor('editor', config);
})();
</script>
</body>
</html>`;
}

module.exports = { createEditorRouter };