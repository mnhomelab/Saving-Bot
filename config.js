'use strict';

const fs   = require('fs');
const path = require('path');

// ── Whitelist ─────────────────────────────────────────────────────────────────
const WHITELIST = [
    "923111794794",     // ← YOUR number
    "161942429786177",  // ← YOUR number (LID)
    "9232421318958",     // ← SECOND contact's number
    "133971645766855"   // ← SECOND contact's number (LID)
];

// ── Notification recipients (actual phone numbers only, no LIDs) ─────────────
const NOTIFY_NUMBERS = [
    "923111794794",
    "9232421318958",
];

// ── Template path ─────────────────────────────────────────────────────────────
const TEMPLATE_PATH = path.join(__dirname, 'Template.xlsx');

// ── Year folder (fixed name, all year files live here) ────────────────────────
const YEAR_FOLDER = path.join(__dirname, 'Saving-Year');
if (!fs.existsSync(YEAR_FOLDER)) fs.mkdirSync(YEAR_FOLDER, { recursive: true });

// ── Persistent settings (bot_settings.json in root folder) ───────────────────
const SETTINGS_FILE = path.join(__dirname, 'bot_settings.json');

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
    isSchedulerStopped,
    stopSchedulerForNumber,
    startSchedulerForNumber,
    NOTIFY_NUMBERS,
    WHITELIST,
    TEMPLATE_PATH,
    YEAR_FOLDER,
    getActiveYear,
    setActiveYear,
    getExcelPath,
};