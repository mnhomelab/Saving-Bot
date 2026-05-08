'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// EDITOR — /edit route: full Excel-like dark-mode spreadsheet editor
// Routes:
//   GET  /edit                  → spreadsheet HTML
//   GET  /api/edit/files        → list xlsx files in Saving-Year/
//   GET  /api/edit/sheets       → sheet names for a file
//   GET  /api/edit/data         → full cell data for one sheet
//   POST /api/edit/cell         → update a single cell
// ─────────────────────────────────────────────────────────────────────────────
const path     = require('path');
const fs       = require('fs');
const ExcelJS  = require('exceljs');
const { getExcelPath, YEAR_FOLDER } = require('./config');

// ── Backup directory ──────────────────────────────────────────────────────────
const BACKUP_DIR = path.join(YEAR_FOLDER, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MAX_BACKUPS_PER_FILE = 20;

/**
 * Copy `filePath` into BACKUP_DIR with a timestamp suffix before any write.
 * Prunes oldest backups for this file when count exceeds MAX_BACKUPS_PER_FILE.
 * Returns the backup filename on success, null on failure (non-fatal).
 */
function createBackup(filePath) {
    try {
        const base = path.basename(filePath, '.xlsx');
        const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-05-09T14-23-11
        const backupName = `${base}_${ts}.xlsx`;
        const backupPath = path.join(BACKUP_DIR, backupName);
        fs.copyFileSync(filePath, backupPath);

        // Prune: keep newest MAX_BACKUPS_PER_FILE backups for this base name
        const all = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith(base + '_') && f.endsWith('.xlsx'))
            .sort(); // ISO timestamps sort lexicographically = chronologically
        if (all.length > MAX_BACKUPS_PER_FILE) {
            all.slice(0, all.length - MAX_BACKUPS_PER_FILE).forEach(old => {
                try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch {}
            });
        }
        return backupName;
    } catch (e) {
        console.warn('⚠️  Backup failed (non-fatal):', e.message);
        return null;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Exact theme colours extracted from xl/theme/theme1.xml in Template.xlsx
const THEME_COLORS = {
    0:  '#000000',  // dk1  — black (default text on light cells)
    1:  '#ffffff',  // lt1  — white (text on dark headers)
    2:  '#5e8bce',  // dk2  — blue-gray
    3:  '#eeece2',  // lt2  — cream (default unfilled cell bg)
    4:  '#3a5d9c',  // accent1 — navy  (SAVINGS / section headers)
    5:  '#c04e4e',  // accent2 — red   (Total Sum headers)
    6:  '#26aa26',  // accent3 — green (INCOME section)
    7:  '#7860b4',  // accent4 — purple
    8:  '#e68422',  // accent5 — orange (food/transport sections)
    9:  '#846648',  // accent6 — brown
    10: '#4c92ae',  // hlink  — teal
    11: '#969696',  // folHlink — gray
};

function argbToCss(argb) {
    if (!argb || argb === '00000000') return null;
    const hex = argb.length === 8 ? argb.slice(2) : argb;
    // Treat fully-transparent or pure-black-no-fill as no colour
    if (hex.toLowerCase() === '000000' && argb.startsWith('FF') === false) return null;
    return '#' + hex.toLowerCase();
}

// Resolve any ExcelJS colour object (may have .argb OR .theme) to a CSS hex string
function resolveCellColor(colorObj) {
    if (!colorObj) return null;
    if (colorObj.argb) return argbToCss(colorObj.argb);
    if (colorObj.theme !== undefined && colorObj.theme !== null) {
        const base = THEME_COLORS[colorObj.theme];
        if (!base) return null;
        // Apply tint/shade if present (lumMod / lumOff in OOXML → tint in ExcelJS)
        if (colorObj.tint) {
            return applyTint(base, colorObj.tint);
        }
        return base;
    }
    return null;
}

// Apply Excel tint value (-1…1) to a hex colour
function applyTint(hex, tint) {
    try {
        let r = parseInt(hex.slice(1, 3), 16);
        let g = parseInt(hex.slice(3, 5), 16);
        let b = parseInt(hex.slice(5, 7), 16);
        if (tint > 0) {
            r = Math.round(r + (255 - r) * tint);
            g = Math.round(g + (255 - g) * tint);
            b = Math.round(b + (255 - b) * tint);
        } else {
            r = Math.round(r * (1 + tint));
            g = Math.round(g * (1 + tint));
            b = Math.round(b * (1 + tint));
        }
        return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
    } catch { return hex; }
}

function colLetter(n) {
    let s = '';
    while (n > 0) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); }
    return s;
}

async function readSheetData(filePath, sheetName) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const ws = wb.getWorksheet(sheetName);
    if (!ws) return null;

    // Merged cell map: "R:C" → {rs, cs} for master; slave cells marked null
    const mergeMap = {};
    const skipCell = new Set();
    for (const range of ws.mergeCells ? [] : []) { /* ExcelJS exposes differently */ }
    // ExcelJS mergedCells via model
    try {
        const model = ws.model;
        if (model && model.merges) {
            for (const m of model.merges) {
                // m is like "A1:C3"
                const [tl, br] = m.split(':');
                const r1 = ws.getCell(tl).row, c1 = ws.getCell(tl).col;
                const r2 = ws.getCell(br).row, c2 = ws.getCell(br).col;
                const rs = r2 - r1 + 1, cs = c2 - c1 + 1;
                mergeMap[`${r1}:${c1}`] = { rs, cs };
                for (let r = r1; r <= r2; r++)
                    for (let c = c1; c <= c2; c++)
                        if (r !== r1 || c !== c1) skipCell.add(`${r}:${c}`);
            }
        }
    } catch {}

    // Column widths
    const colWidths = {};
    ws.columns.forEach((col, i) => { if (col.width) colWidths[i + 1] = Math.round(col.width * 7); });

    // Row heights
    const rowHeights = {};
    ws.eachRow((row) => { if (row.height) rowHeights[row.number] = Math.round(row.height * 1.333); });

    const cells = {};
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
        row.eachCell({ includeEmpty: false }, (cell, colNum) => {
            const key = `${rowNum}:${colNum}`;
            if (skipCell.has(key)) { cells[key] = null; return; }

            let value = cell.value;
            let formula = null;

            if (value !== null && value !== undefined && typeof value === 'object') {
                if (value instanceof Date) {
                    // Top-level Date value
                    value = value.toLocaleDateString('en-PK');
                } else if ('formula' in value || 'sharedFormula' in value) {
                    // Regular formula OR shared formula (ExcelJS uses different keys)
                    formula = value.formula || value.sharedFormula || '';
                    value = value.result ?? '';
                    // result itself may be a Date, error object, or other object
                    if (value instanceof Date) {
                        value = value.toLocaleDateString('en-PK');
                    } else if (value !== null && value !== undefined && typeof value === 'object') {
                        if ('error' in value) value = value.error || '#ERR';
                        else value = String(value);
                    }
                } else if ('richText' in value) {
                    value = value.richText.map(r => r.text).join('');
                } else if ('error' in value) {
                    value = value.error || '#ERR';
                } else {
                    // Catch-all — avoids raw [object Object]
                    value = JSON.stringify(value);
                }
            }

            const s = {};
            const f  = cell.font      || {};
            const fi = cell.fill      || {};
            const al = cell.alignment || {};

            if (f.bold)   s.b  = 1;
            if (f.italic) s.i  = 1;
            if (f.size && f.size !== 11) s.sz = f.size;

            // Font colour — resolve ARGB or theme index
            const fc = resolveCellColor(f.color);
            if (fc) s.fc = fc;

            // Background — only for solid/pattern fills
            let bg = null;
            if (fi.type === 'pattern' && fi.pattern && fi.pattern !== 'none') {
                bg = resolveCellColor(fi.fgColor);
            }
            if (bg) s.bg = bg;

            if (al.horizontal && al.horizontal !== 'general') s.ha = al.horizontal;
            if (al.wrapText) s.wrap = 1;

            const m = mergeMap[key];
            cells[key] = {
                v: value,
                f: formula,
                s: Object.keys(s).length ? s : undefined,
                ...(m ? { rs: m.rs, cs: m.cs } : {}),
            };
        });
    });

    return {
        maxRow: ws.rowCount,
        maxCol: ws.columnCount,
        colWidths,
        rowHeights,
        cells,
    };
}

// ── Router factory (called by dashboard.js with requireSession middleware) ────
function createEditorRouter(app, requireSession) {

    // List xlsx files
    app.get('/api/edit/files', requireSession, (req, res) => {
        try {
            const files = fs.readdirSync(YEAR_FOLDER)
                .filter(f => f.endsWith('.xlsx'))
                .sort()
                .reverse();
            res.json({ ok: true, files });
        } catch { res.json({ ok: true, files: [] }); }
    });

    // List sheets for a file
    app.get('/api/edit/sheets', requireSession, async (req, res) => {
        const fileName = path.basename(req.query.file || '');
        if (!fileName) return res.json({ ok: false, error: 'No file specified' });
        const filePath = path.join(YEAR_FOLDER, fileName);
        if (!fs.existsSync(filePath)) return res.json({ ok: false, error: 'File not found' });
        try {
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.readFile(filePath);
            const sheets = wb.worksheets.map(ws => ws.name);
            res.json({ ok: true, sheets });
        } catch (e) { res.json({ ok: false, error: e.message }); }
    });

    // Full sheet data
    app.get('/api/edit/data', requireSession, async (req, res) => {
        const fileName = path.basename(req.query.file || '');
        const sheetName = req.query.sheet || '';
        if (!fileName || !sheetName) return res.json({ ok: false, error: 'file and sheet required' });
        const filePath = path.join(YEAR_FOLDER, fileName);
        if (!fs.existsSync(filePath)) return res.json({ ok: false, error: 'File not found' });
        try {
            const data = await readSheetData(filePath, sheetName);
            if (!data) return res.json({ ok: false, error: 'Sheet not found' });
            res.json({ ok: true, ...data });
        } catch (e) { res.json({ ok: false, error: e.message }); }
    });

    // Update a cell
    app.post('/api/edit/cell', requireSession, async (req, res) => {
        const { file, sheet, row, col, value } = req.body;
        if (!file || !sheet || !row || !col) return res.json({ ok: false, error: 'Missing params' });
        const fileName = path.basename(file);
        const filePath = path.join(YEAR_FOLDER, fileName);
        if (!fs.existsSync(filePath)) return res.json({ ok: false, error: 'File not found' });
        try {
            // ── Backup BEFORE any write ───────────────────────────────────────
            const backupName = createBackup(filePath);
            console.log(`💾 Backup created: ${backupName || '(failed)'} before editing ${fileName}`);

            const wb = new ExcelJS.Workbook();
            await wb.xlsx.readFile(filePath);
            const ws = wb.getWorksheet(sheet);
            if (!ws) return res.json({ ok: false, error: 'Sheet not found' });
            const cell = ws.getCell(Number(row), Number(col));
            const v = String(value ?? '').trim();
            if (v === '') {
                cell.value = null;
            } else if (v.startsWith('=')) {
                cell.value = { formula: v.slice(1), result: 0 };
            } else if (v !== '' && !isNaN(v)) {
                cell.value = parseFloat(v);
            } else {
                cell.value = v;
            }
            await wb.xlsx.writeFile(filePath);
            res.json({ ok: true, backup: backupName });
        } catch (e) { res.json({ ok: false, error: e.message }); }
    });

    // List backups for a file
    app.get('/api/edit/backups', requireSession, (req, res) => {
        const fileName = path.basename(req.query.file || '');
        if (!fileName) return res.json({ ok: false, error: 'No file specified' });
        try {
            const base = fileName.replace(/\.xlsx$/i, '');
            const backups = fs.readdirSync(BACKUP_DIR)
                .filter(f => f.startsWith(base + '_') && f.endsWith('.xlsx'))
                .sort().reverse()   // newest first
                .map(name => {
                    const stat = fs.statSync(path.join(BACKUP_DIR, name));
                    return { name, size: stat.size, mtime: stat.mtime };
                });
            res.json({ ok: true, backups });
        } catch (e) { res.json({ ok: false, error: e.message }); }
    });

    // Download a backup file
    app.get('/api/edit/backup-download', requireSession, (req, res) => {
        const name = path.basename(req.query.name || '');
        if (!name) return res.status(400).send('No name');
        const filePath = path.join(BACKUP_DIR, name);
        if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
        res.download(filePath, name);
    });

    // Editor HTML
    app.get('/edit', requireSession, (req, res) => res.send(editorHtml()));
}

// ── Editor HTML page ──────────────────────────────────────────────────────────
function editorHtml() { return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spreadsheet Editor · Saving Bot</title>

<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  /* ── Template.xlsx-matched light theme ──────────────────────────────────
     Colors resolved from xl/theme/theme1.xml in the actual workbook:
       accent3 #26aa26 = INCOME green  |  accent1 #3a5d9c = navy sections
       accent5 #e68422 = orange        |  #ffc000 = amber summary row
       dk1 #000000 = default text      |  lt1 #ffffff = text on dark headers  */
  --bg:#f0eeea;           /* warm off-white — matches lt2 cream outside cells  */
  --surface:#ffffff;      /* toolbar / panel background                         */
  --surface2:#f4f2ee;     /* secondary surface                                  */
  --border:#c8c4bb;       /* grid lines & panel borders                         */
  --text:#000000;         /* dk1 — default cell text matches template           */
  --muted:#6b6560;        /* secondary labels                                   */
  --muted2:#958f88;       /* tertiary labels                                    */
  --accent:#26aa26;       /* accent3 green = INCOME — primary UI accent         */
  --accent2:#3a5d9c;      /* accent1 navy  = section headers                    */
  --sel:rgba(58,93,156,.15); /* navy tint selection highlight                   */
  --cell-bg:#ffffff;      /* data cells: white, same as unfilled Excel cells    */
  --hdr-bg:#e8e5de;       /* row/col number headers: warm gray (Excel-style)    */
  --hdr-border:#bbb5aa;   /* header border                                      */
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:Calibri,'Segoe UI',Arial,sans-serif;overflow:hidden}

/* ── Toolbar ── */
.toolbar{background:var(--surface);border-bottom:2px solid var(--border);padding:6px 12px;display:flex;align-items:center;gap:10px;flex-shrink:0;z-index:100;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.toolbar-title{font-size:13px;font-weight:700;color:var(--accent2);margin-right:4px}
select{background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:4px 10px;font-size:12px;outline:none;cursor:pointer;font-family:inherit}
select:focus{border-color:var(--accent2);box-shadow:0 0 0 2px rgba(58,93,156,.15)}
.sep{width:1px;height:20px;background:var(--border)}
.tag{background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:3px 8px;font-size:11px;color:var(--muted)}
.btn{background:var(--accent2);border:none;border-radius:4px;color:#fff;padding:5px 12px;font-size:12px;cursor:pointer;transition:opacity .15s;font-weight:600;font-family:inherit}
.btn:hover{opacity:.88}
.btn.sec{background:var(--surface2);color:var(--text);border:1px solid var(--border)}
.btn.sec:hover{border-color:var(--accent2);color:var(--accent2)}

/* ── Formula bar ── */
.fbar{background:#f9f7f3;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;padding:3px 10px;flex-shrink:0}
.cell-ref{background:var(--surface);border:1px solid var(--border);border-radius:3px;padding:3px 10px;min-width:64px;text-align:center;font-family:monospace;font-size:12px;color:var(--accent2);font-weight:700}
.fx-label{color:var(--muted);font-size:12px;font-style:italic;padding:0 4px}
.fbar-input{flex:1;background:transparent;border:none;color:var(--text);font-family:monospace;font-size:12px;outline:none;padding:3px 6px}
.fbar-input:focus{background:rgba(58,93,156,.06);border-radius:3px}

/* ── Layout ── */
.layout{display:flex;flex-direction:column;height:100vh}
.grid-outer{flex:1;overflow:auto;position:relative;background:var(--bg)}
.grid-outer::-webkit-scrollbar{width:10px;height:10px}
.grid-outer::-webkit-scrollbar-track{background:var(--surface2)}
.grid-outer::-webkit-scrollbar-thumb{background:#c0bab2;border-radius:4px}
.grid-outer::-webkit-scrollbar-thumb:hover{background:#a8a096}
/* Sheet tabs — match Excel tab bar */
.tabbar{background:#dedad4;border-top:1px solid var(--border);display:flex;overflow-x:auto;flex-shrink:0;scrollbar-width:thin;padding:4px 4px 0;gap:2px}
.tabbar::-webkit-scrollbar{height:4px}
.tabbar::-webkit-scrollbar-thumb{background:#bbb5aa}
.tab{background:#cdc9c1;color:var(--muted);padding:5px 16px;border-radius:4px 4px 0 0;font-size:11px;cursor:pointer;white-space:nowrap;border:1px solid var(--hdr-border);border-bottom:none;transition:all .15s;user-select:none;font-family:inherit}
.tab:hover{background:#e8e5de;color:var(--text)}
.tab.active{background:#ffffff;color:var(--accent2);border-color:var(--border);font-weight:700}

/* ── Grid table ── */
table{border-collapse:collapse;font-size:12px;font-family:Calibri,'Segoe UI',Arial,sans-serif}

/* Column header (A B C …) — Excel-style warm gray */
.ch{background:var(--hdr-bg);color:var(--muted);text-align:center;font-size:10px;font-weight:600;
    padding:2px 0;position:sticky;top:0;z-index:20;user-select:none;
    border:1px solid var(--hdr-border);white-space:nowrap}
/* Row number cell */
.rn{background:var(--hdr-bg);color:var(--muted);text-align:right;font-size:10px;font-weight:500;
    padding:0 5px 0 2px;position:sticky;left:0;z-index:15;user-select:none;
    border:1px solid var(--hdr-border);min-width:38px;white-space:nowrap}
/* Corner */
.corner{position:sticky;top:0;left:0;z-index:25;background:var(--hdr-bg);border:1px solid var(--hdr-border)}

/* Data cells — white bg = unfilled Excel cell */
td.dc{padding:1px 4px;cursor:cell;vertical-align:middle;border:1px solid #d0ccc5;
      white-space:nowrap;overflow:hidden;max-width:400px;color:var(--text);
      background:var(--cell-bg);position:relative}
td.dc.num{text-align:right}
td.dc.fml{color:#1d6b1d}  /* formula cells: dark green, readable on white */
td.dc.sel{background:rgba(58,93,156,.13)!important;outline:2px solid #3a5d9c;outline-offset:-2px;z-index:5}
td.dc.sel-col,.ch.sel-col{background:rgba(58,93,156,.08)!important}
td.dc.sel-row,.rn.sel-row{background:rgba(58,93,156,.08)!important}
td.dc.editing-cell{padding:0!important;overflow:visible;z-index:30}
td.dc.editing-cell input{
  position:absolute;inset:0;width:100%;min-width:120px;
  background:#ffffff;color:#000;border:2px solid #3a5d9c;
  font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:12px;padding:0 4px;
  outline:none;z-index:30;box-shadow:0 2px 8px rgba(58,93,156,.2)}

/* Hover — very subtle on white cells */
td.dc:hover:not(.sel){background:rgba(58,93,156,.05)!important}
.ch.sel-col,.ch:hover{background:#d4d0c8!important;cursor:default}

.loading{display:flex;align-items:center;justify-content:center;height:300px;color:var(--muted);font-size:13px;gap:10px}
.spin{width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--accent2);border-radius:50%;animation:sp .7s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}

.saved-toast{position:fixed;bottom:48px;right:16px;background:#eefaee;border:1px solid #26aa26;color:#1a6e1a;
  border-radius:6px;padding:8px 16px;font-size:12px;z-index:999;opacity:0;transition:opacity .3s;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.saved-toast.show{opacity:1}

/* ── Backup panel ── */
.bk-overlay{position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:200;display:none;align-items:flex-start;justify-content:flex-end;padding:48px 16px 0}
.bk-overlay.open{display:flex}
.bk-panel{background:var(--surface);border:1px solid var(--border);border-radius:8px;width:380px;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.bk-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--border);background:#f4f2ee;border-radius:8px 8px 0 0}
.bk-head h3{font-size:13px;font-weight:700;color:var(--accent2);margin:0}
.bk-close{background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;padding:0 4px}
.bk-close:hover{color:var(--text)}
.bk-body{overflow-y:auto;flex:1;padding:6px 0}
.bk-body::-webkit-scrollbar{width:6px}
.bk-body::-webkit-scrollbar-thumb{background:#c0bab2;border-radius:3px}
.bk-item{display:flex;align-items:center;justify-content:space-between;padding:7px 14px;font-size:11px;border-bottom:1px solid #eae7e1;gap:8px}
.bk-item:last-child{border-bottom:none}
.bk-name{color:var(--text);font-family:monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bk-meta{color:var(--muted2);white-space:nowrap;font-size:10px}
.bk-dl{background:var(--surface2);border:1px solid var(--border);border-radius:4px;color:var(--accent2);font-size:10px;padding:2px 8px;cursor:pointer;text-decoration:none;white-space:nowrap;font-weight:600}
.bk-dl:hover{border-color:var(--accent2);background:#eaf0f9}
.bk-empty{padding:24px;text-align:center;color:var(--muted);font-size:12px}
</style>
</head>
<body>
<div class="layout">

<!-- Toolbar -->
<div class="toolbar">
  <span class="toolbar-title">💾 Spreadsheet Editor</span>
  <div class="sep"></div>
  <label style="font-size:11px;color:var(--muted2)">File</label>
  <select id="fileSelect" onchange="onFileChange(this.value)"><option>Loading…</option></select>
  <div class="sep"></div>
  <span id="cellCount" class="tag">—</span>
  <div style="flex:1"></div>
  <button class="btn sec" onclick="openBackups()" title="View & download backups" style="font-size:12px">🗂 Backups</button>
  <a class="btn sec" href="/" style="text-decoration:none;padding:5px 12px;font-size:12px">← Dashboard</a>
</div>

<!-- Formula bar -->
<div class="fbar">
  <div class="cell-ref" id="cellRef">A1</div>
  <div class="fx-label">fx</div>
  <input class="fbar-input" id="fbarInput" placeholder="Select a cell…" readonly
         onkeydown="fbarKeyDown(event)" onchange="fbarCommit()">
</div>

<!-- Grid -->
<div class="grid-outer" id="gridOuter">
  <div class="loading"><div class="spin"></div> Loading files…</div>
</div>

<!-- Sheet tabs -->
<div class="tabbar" id="tabbar"></div>

</div>
<div class="saved-toast" id="savedToast">✓ Saved</div>

<!-- Backup panel -->
<div class="bk-overlay" id="bkOverlay" onclick="e => { if(e.target===this) closeBackups(); }">
  <div class="bk-panel">
    <div class="bk-head">
      <h3>🗂 Backups</h3>
      <button class="bk-close" onclick="closeBackups()">✕</button>
    </div>
    <div class="bk-body" id="bkBody"><div class="bk-empty">Loading…</div></div>
  </div>
</div>

<script>
let curFile = '', curSheet = '', selR = 0, selC = 0;
let sheetData = null; // { maxRow, maxCol, colWidths, rowHeights, cells }
let editing = false;
let pendingSave = null;

const NUM_FMT = n => typeof n === 'number' ? n.toLocaleString('en-PK') : (n ?? '');

// ── Color contrast helper ─────────────────────────────────────────────────────
function isLightBg(hex) {
    if (!hex || hex.length < 7) return true; // default white cell = light
    try {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return (r * 299 + g * 587 + b * 114) / 1000 > 140;
    } catch { return true; }
}

// ── Col letter ────────────────────────────────────────────────────────────────
function colLetter(n) {
    let s = '';
    while (n > 0) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); }
    return s;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    const r = await fetch('/api/edit/files');
    const d = await r.json();
    const sel = document.getElementById('fileSelect');
    sel.innerHTML = d.files.length
        ? d.files.map(f => \`<option value="\${f}">\${f}</option>\`).join('')
        : '<option>No xlsx files found</option>';
    if (d.files.length) onFileChange(d.files[0]);
}

// ── File changed ──────────────────────────────────────────────────────────────
async function onFileChange(file) {
    curFile = file;
    curSheet = '';
    document.getElementById('tabbar').innerHTML = '';
    setGrid('<div class="loading"><div class="spin"></div> Loading sheets…</div>');
    const r = await fetch('/api/edit/sheets?file=' + encodeURIComponent(file));
    const d = await r.json();
    if (!d.ok) { setGrid('<div class="loading">Error: ' + (d.error||'unknown') + '</div>'); return; }
    const tb = document.getElementById('tabbar');
    tb.innerHTML = d.sheets.map(s =>
        \`<div class="tab" onclick="loadSheet('\${escH(s)}')">\${escH(s)}</div>\`
    ).join('');
    if (d.sheets.length) loadSheet(d.sheets[0]);
}

// ── Load sheet ────────────────────────────────────────────────────────────────
async function loadSheet(sheet) {
    curSheet = sheet;
    // Update tab highlight
    document.querySelectorAll('.tab').forEach(t =>
        t.classList.toggle('active', t.textContent === sheet));
    setGrid('<div class="loading"><div class="spin"></div> Loading ' + escH(sheet) + '…</div>');
    const r = await fetch('/api/edit/data?file=' + encodeURIComponent(curFile) + '&sheet=' + encodeURIComponent(sheet));
    const d = await r.json();
    if (!d.ok) { setGrid('<div class="loading">Error: ' + (d.error||'unknown') + '</div>'); return; }
    sheetData = d;
    document.getElementById('cellCount').textContent =
        d.maxRow + ' rows × ' + d.maxCol + ' cols';
    renderGrid(d);
}

// ── Render grid ───────────────────────────────────────────────────────────────
function renderGrid(d) {
    const { maxRow, maxCol, colWidths, rowHeights, cells } = d;
    const frag = [];
    frag.push('<table id="ssheet" cellspacing="0" cellpadding="0">');
    // Header row
    frag.push('<thead><tr>');
    frag.push('<th class="ch corner" style="min-width:38px;width:38px"></th>');
    for (let c = 1; c <= maxCol; c++) {
        const w = colWidths[c] || 80;
        frag.push(\`<th class="ch" id="ch\${c}" style="min-width:\${w}px;width:\${w}px">\${colLetter(c)}</th>\`);
    }
    frag.push('</tr></thead><tbody>');

    // Data rows
    for (let r = 1; r <= maxRow; r++) {
        const rh = rowHeights[r] ? \`height:\${rowHeights[r]}px\` : 'height:22px';
        frag.push(\`<tr><td class="rn" id="rn\${r}" style="\${rh}">\${r}</td>\`);
        for (let c = 1; c <= maxCol; c++) {
            const key = \`\${r}:\${c}\`;
            const cell = cells[key];
            if (cell === null) continue; // merged slave
            frag.push(cellHtml(r, c, cell, colWidths[c] || 80));
        }
        frag.push('</tr>');
    }
    frag.push('</tbody></table>');

    const go = document.getElementById('gridOuter');
    go.innerHTML = frag.join('');
    go.scrollTop = 0; go.scrollLeft = 0;

    // Bind click events via delegation
    go.addEventListener('mousedown', onCellMouseDown);
    go.addEventListener('dblclick', onCellDblClick);
    document.addEventListener('keydown', onKeyDown);
    selectCell(1, 1);
}

function cellHtml(r, c, cell, w) {
    if (!cell) {
        return \`<td class="dc" id="c\${r}_\${c}" data-r="\${r}" data-c="\${c}" style="min-width:\${w}px;width:\${w}px"></td>\`;
    }
    const { v, f, s, rs, cs } = cell;
    let style = \`min-width:\${w}px;width:\${w}px;\`;
    let cls = 'dc';
    if (s) {
        if (s.bg) style += \`background:\${s.bg};\`;
        if (s.fc) {
            style += \`color:\${s.fc};\`;
        } else if (s.bg) {
            // No explicit font colour from Excel — auto-pick to match template contrast:
            // dark header cells (green/navy/orange) → white; light/unfilled → black
            style += isLightBg(s.bg) ? 'color:#000000;' : 'color:#ffffff;';
        }
        if (s.b)  style += 'font-weight:700;';
        if (s.i)  style += 'font-style:italic;';
        if (s.sz) style += \`font-size:\${s.sz}px;\`;
        if (s.ha) style += \`text-align:\${s.ha};\`;
        if (s.wrap) style += 'white-space:normal;';
    }
    if (f) cls += ' fml';
    else if (typeof v === 'number') cls += ' num';
    const disp = f ? NUM_FMT(v) : (typeof v === 'number' ? NUM_FMT(v) : (v ?? ''));
    const rsAttr = rs > 1 ? \` rowspan="\${rs}"\` : '';
    const csAttr = cs > 1 ? \` colspan="\${cs}"\` : '';
    return \`<td class="\${cls}" id="c\${r}_\${c}" data-r="\${r}" data-c="\${c}" style="\${style}"\${rsAttr}\${csAttr} title="\${escH(String(disp))}">\${escH(String(disp))}</td>\`;
}

// ── Select cell ───────────────────────────────────────────────────────────────
function selectCell(r, c, keepEdit) {
    if (!sheetData) return;
    if (!keepEdit && editing) commitEdit();
    // Deselect prev
    if (selR && selC) {
        const prev = document.getElementById(\`c\${selR}_\${selC}\`);
        if (prev) prev.classList.remove('sel');
        const prevRn = document.getElementById(\`rn\${selR}\`);
        const prevCh = document.getElementById(\`ch\${selC}\`);
        if (prevRn) prevRn.classList.remove('sel-row');
        if (prevCh) prevCh.classList.remove('sel-col');
    }
    selR = r; selC = c;
    const td = document.getElementById(\`c\${r}_\${c}\`);
    if (!td) return;
    td.classList.add('sel');
    const rn = document.getElementById(\`rn\${r}\`);
    const ch = document.getElementById(\`ch\${c}\`);
    if (rn) rn.classList.add('sel-row');
    if (ch) ch.classList.add('sel-col');
    // Formula bar
    const cell = sheetData.cells[\`\${r}:\${c}\`];
    document.getElementById('cellRef').textContent = colLetter(c) + r;
    const fi = document.getElementById('fbarInput');
    fi.readOnly = true;
    if (cell) {
        fi.value = cell.f ? ('=' + cell.f) : (cell.v ?? '');
    } else { fi.value = ''; }
    // Scroll into view
    td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ── Mouse events ──────────────────────────────────────────────────────────────
function onCellMouseDown(e) {
    const td = e.target.closest('td[data-r]');
    if (!td) return;
    const r = +td.dataset.r, c = +td.dataset.c;
    if (r === selR && c === selC && editing) return;
    selectCell(r, c);
}

function onCellDblClick(e) {
    const td = e.target.closest('td[data-r]');
    if (!td) return;
    startEdit(+td.dataset.r, +td.dataset.c);
}

// ── Keyboard nav ──────────────────────────────────────────────────────────────
function onKeyDown(e) {
    if (!selR) return;
    // Ignore if typing in fbar input
    if (document.activeElement === document.getElementById('fbarInput')) return;
    if (editing) {
        if (e.key === 'Escape') { cancelEdit(); return; }
        if (e.key === 'Enter') { e.preventDefault(); commitEdit(); moveBy(1, 0); return; }
        if (e.key === 'Tab')   { e.preventDefault(); commitEdit(); moveBy(0, e.shiftKey ? -1 : 1); return; }
        return;
    }
    switch (e.key) {
        case 'ArrowUp':    e.preventDefault(); moveBy(-1, 0); break;
        case 'ArrowDown':  e.preventDefault(); moveBy(1, 0);  break;
        case 'ArrowLeft':  e.preventDefault(); moveBy(0, -1); break;
        case 'ArrowRight': e.preventDefault(); moveBy(0, 1);  break;
        case 'Tab':        e.preventDefault(); moveBy(0, e.shiftKey ? -1 : 1); break;
        case 'Enter':      e.preventDefault(); startEdit(selR, selC); break;
        case 'F2':         e.preventDefault(); startEdit(selR, selC); break;
        case 'Delete': case 'Backspace':
            e.preventDefault(); clearCell(); break;
        default:
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                startEdit(selR, selC, e.key);
            }
    }
}

function moveBy(dr, dc) {
    const r = Math.max(1, Math.min(sheetData.maxRow, selR + dr));
    const c = Math.max(1, Math.min(sheetData.maxCol, selC + dc));
    selectCell(r, c);
}

// ── Edit mode ─────────────────────────────────────────────────────────────────
function startEdit(r, c, initChar) {
    const td = document.getElementById(\`c\${r}_\${c}\`);
    if (!td) return;
    editing = true;
    td.classList.add('editing-cell');
    const cell = sheetData.cells[\`\${r}:\${c}\`];
    const initVal = initChar !== undefined ? initChar
        : (cell?.f ? ('=' + cell.f) : String(cell?.v ?? ''));
    const inp = document.createElement('input');
    inp.value = initVal;
    inp.style.cssText = "position:absolute;inset:0;width:100%;min-width:120px;background:#0a1a2e;color:#fff;border:2px solid #0f766e;font-family:monospace;font-size:12px;padding:0 4px;outline:none;z-index:30;";
    td.innerHTML = '';
    td.appendChild(inp);
    inp.focus();
    if (initChar === undefined) inp.select(); else inp.setSelectionRange(inp.value.length, inp.value.length);
    inp.addEventListener('blur', commitEdit);
    inp.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.stopPropagation(); cancelEdit(); }
        else if (e.key === 'Enter') { e.stopPropagation(); commitEdit(); moveBy(1, 0); }
        else if (e.key === 'Tab')   { e.stopPropagation(); commitEdit(); moveBy(0, e.shiftKey ? -1 : 1); }
    });
    // Update formula bar live
    inp.addEventListener('input', () => {
        document.getElementById('fbarInput').value = inp.value;
    });
    document.getElementById('fbarInput').value = initVal;
}

function commitEdit() {
    if (!editing) return;
    const td = document.getElementById(\`c\${selR}_\${selC}\`);
    if (!td) { editing = false; return; }
    const inp = td.querySelector('input');
    const newVal = inp ? inp.value : '';
    editing = false;
    td.classList.remove('editing-cell');
    // Update local state
    const key = \`\${selR}:\${selC}\`;
    if (!sheetData.cells[key]) sheetData.cells[key] = {};
    const cell = sheetData.cells[key];
    if (newVal.startsWith('=')) {
        cell.f = newVal.slice(1); cell.v = 0;
    } else if (!isNaN(newVal) && newVal.trim() !== '') {
        cell.f = null; cell.v = parseFloat(newVal);
    } else {
        cell.f = null; cell.v = newVal;
    }
    // Re-render this cell
    const w = sheetData.colWidths[selC] || 80;
    const newHtml = cellHtml(selR, selC, cell, w);
    const tmp = document.createElement('table');
    tmp.innerHTML = '<tbody><tr>' + newHtml + '</tr></tbody>';
    const newTd = tmp.querySelector('td');
    td.parentNode.replaceChild(newTd, td);
    newTd.classList.add('sel');
    // Update formula bar
    document.getElementById('fbarInput').value = cell.f ? ('=' + cell.f) : (cell.v ?? '');
    // Save to server
    saveCell(selR, selC, newVal);
}

function cancelEdit() {
    if (!editing) return;
    editing = false;
    const td = document.getElementById(\`c\${selR}_\${selC}\`);
    if (td) {
        td.classList.remove('editing-cell');
        const cell = sheetData.cells[\`\${selR}:\${selC}\`];
        const w = sheetData.colWidths[selC] || 80;
        const newHtml = cellHtml(selR, selC, cell, w);
        const tmp = document.createElement('table');
        tmp.innerHTML = '<tbody><tr>' + newHtml + '</tr></tbody>';
        const newTd = tmp.querySelector('td');
        td.parentNode.replaceChild(newTd, td);
        newTd.classList.add('sel');
    }
    selectCell(selR, selC);
}

function clearCell() {
    const key = \`\${selR}:\${selC}\`;
    if (sheetData.cells[key]) { sheetData.cells[key].v = null; sheetData.cells[key].f = null; }
    const td = document.getElementById(\`c\${selR}_\${selC}\`);
    if (td) { td.textContent = ''; }
    document.getElementById('fbarInput').value = '';
    saveCell(selR, selC, '');
}

// ── Formula bar direct edit ───────────────────────────────────────────────────
function fbarKeyDown(e) {
    if (e.key === 'Enter') { fbarCommit(); e.preventDefault(); }
    if (e.key === 'Escape') { selectCell(selR, selC); }
}

function fbarCommit() {
    const fi = document.getElementById('fbarInput');
    if (fi.readOnly) return;
    commitEdit();
    fi.readOnly = true;
}

document.getElementById('fbarInput').addEventListener('focus', () => {
    if (!selR) return;
    const fi = document.getElementById('fbarInput');
    fi.readOnly = false;
    // Sync to cell edit
    startEdit(selR, selC, undefined);
    fi.focus(); // keep focus on fbar
});

// ── Save cell ─────────────────────────────────────────────────────────────────
async function saveCell(r, c, value) {
    try {
        const resp = await fetch('/api/edit/cell', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ file: curFile, sheet: curSheet, row: r, col: c, value })
        });
        const data = await resp.json();
        if (data.ok) {
            showToast(data.backup);
        } else {
            showToast(null, data.error || 'Save failed');
        }
    } catch (e) { showToast(null, 'Network error'); }
}

function showToast(backupName, errMsg) {
    const t = document.getElementById('savedToast');
    if (errMsg) {
        t.style.background = '#fff0f0';
        t.style.borderColor = '#c04e4e';
        t.style.color = '#7a1c1c';
        t.textContent = '✗ ' + errMsg;
    } else {
        t.style.background = '#eefaee';
        t.style.borderColor = '#26aa26';
        t.style.color = '#1a6e1a';
        t.textContent = backupName ? \`✓ Saved · backup: \${backupName}\` : '✓ Saved';
    }
    t.classList.add('show');
    clearTimeout(window._tt);
    window._tt = setTimeout(() => t.classList.remove('show'), 2800);
}

// ── Backup panel ──────────────────────────────────────────────────────────────
function openBackups() {
    document.getElementById('bkOverlay').classList.add('open');
    loadBackups();
}
function closeBackups() {
    document.getElementById('bkOverlay').classList.remove('open');
}
// Close on overlay click
document.getElementById('bkOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeBackups();
});

async function loadBackups() {
    const body = document.getElementById('bkBody');
    body.innerHTML = '<div class="bk-empty">Loading…</div>';
    if (!curFile) { body.innerHTML = '<div class="bk-empty">No file selected.</div>'; return; }
    try {
        const r = await fetch('/api/edit/backups?file=' + encodeURIComponent(curFile));
        const d = await r.json();
        if (!d.ok || !d.backups.length) {
            body.innerHTML = '<div class="bk-empty">No backups yet for this file.<br>Backups are created automatically on every save.</div>';
            return;
        }
        body.innerHTML = d.backups.map(b => {
            const dt = new Date(b.mtime).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
            const kb = (b.size / 1024).toFixed(1) + ' KB';
            return \`<div class="bk-item">
  <span class="bk-name" title="\${escH(b.name)}">\${escH(b.name)}</span>
  <span class="bk-meta">\${kb} · \${escH(dt)}</span>
  <a class="bk-dl" href="/api/edit/backup-download?name=\${encodeURIComponent(b.name)}" download="\${escH(b.name)}">⬇ Download</a>
</div>\`;
        }).join('');
    } catch {
        body.innerHTML = '<div class="bk-empty">Failed to load backups.</div>';
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setGrid(html) { document.getElementById('gridOuter').innerHTML = html; }
function escH(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
</script>
</body>
</html>`; }

module.exports = { createEditorRouter };