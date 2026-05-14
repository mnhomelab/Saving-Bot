'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../..');
const resolveFromRoot = (...parts) => path.resolve(ROOT_DIR, ...parts);

// ── Load .env ─────────────────────────────────────────────────────────────────
// Native Node.js .env loading (v20.6+) — no dotenv package needed.
// Falls back silently if .env is missing (e.g. values set via docker-compose env).
try {
    require('fs').readFileSync(resolveFromRoot('.env'), 'utf8')
        .split('\n')
        .forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) return;
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            // Strip surrounding quotes and remove spaces (handles Gmail-style app passwords)
            if ((val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            // For SMTP_PASS specifically, remove spaces (Google shows them as display separators)
            if (key === 'SMTP_PASS') val = val.replace(/\s+/g, '');
            if (key && !(key in process.env)) process.env[key] = val;
        });
} catch { /* .env not present — values expected from environment */ }

// ── Whitelist ─────────────────────────────────────────────────────────────────
// Read from WHITELIST env var (comma-separated) or fall back to hardcoded list.
const WHITELIST = process.env.WHITELIST
    ? process.env.WHITELIST.split(',').map(n => n.trim()).filter(Boolean)
    : [
        "923111794794",     // ← YOUR number
        "161942429786177",  // ← YOUR number (LID)
        "923244198958",     // ← SECOND contact's number
        "133977293766855",  // ← SECOND contact's number (LID)
    ];

// ── Notification recipients ───────────────────────────────────────────────────
// Read from NOTIFY_NUMBERS env var (comma-separated) or fall back to hardcoded.
const NOTIFY_NUMBERS = process.env.NOTIFY_NUMBERS
    ? process.env.NOTIFY_NUMBERS.split(',').map(n => n.trim()).filter(Boolean)
    : [
        "923111794794",
        "923244198958",
    ];

// ── Template path ─────────────────────────────────────────────────────────────
const TEMPLATE_PATH = process.env.TEMPLATE_PATH
    ? path.resolve(ROOT_DIR, process.env.TEMPLATE_PATH)
    : resolveFromRoot('assets/templates/Template.xlsx');

// ── Year folder (fixed name, all year files live here) ────────────────────────
const YEAR_FOLDER = process.env.YEAR_FOLDER
    ? path.resolve(ROOT_DIR, process.env.YEAR_FOLDER)
    : resolveFromRoot('Saving-Year');
if (!fs.existsSync(YEAR_FOLDER)) fs.mkdirSync(YEAR_FOLDER, { recursive: true });

// ── Persistent settings (bot_settings.json in root folder) ───────────────────
const SETTINGS_FILE = resolveFromRoot('bot_settings.json');

function _loadSettings() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
    catch { return {}; }
}
function _saveSettings(data) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

// ── Scheduler opt-out per number ─────────────────────────────────────────────
function isSchedulerStopped(number) {
    return (_loadSettings().schedulerStopped || []).includes(String(number));
}
function stopSchedulerForNumber(number) {
    const s = _loadSettings();
    s.schedulerStopped = [...new Set([...(s.schedulerStopped || []), String(number)])];
    _saveSettings(s);
}
function startSchedulerForNumber(number) {
    const s = _loadSettings();
    s.schedulerStopped = (s.schedulerStopped || []).filter(n => n !== String(number));
    _saveSettings(s);
}

function getActiveYear() {
    return _loadSettings().activeYear || null;
}
function setActiveYear(year) {
    const s = _loadSettings();
    s.activeYear = year;
    _saveSettings(s);
}

// Returns ./Saving-Year/Saving-2026.xlsx
function getExcelPath(year) {
    const yr = year || getActiveYear();
    return path.join(YEAR_FOLDER, `Saving-${yr}.xlsx`);
}

module.exports = {
    ROOT_DIR,
    resolveFromRoot,
    WHITELIST,
    NOTIFY_NUMBERS,
    TEMPLATE_PATH,
    YEAR_FOLDER,
    getActiveYear,
    setActiveYear,
    getExcelPath,
    isSchedulerStopped,
    stopSchedulerForNumber,
    startSchedulerForNumber,
};