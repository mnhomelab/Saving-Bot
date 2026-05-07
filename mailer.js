'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// MAILER — HTML email alerts for Saving Bot
// ─────────────────────────────────────────────────────────────────────────────

let nodemailer;
try { nodemailer = require('nodemailer'); }
catch { nodemailer = null; }

const SMTP_HOST   = process.env.SMTP_HOST  || '';
const SMTP_PORT   = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER   = process.env.SMTP_USER  || '';
const SMTP_PASS   = (process.env.SMTP_PASS  || '').replace(/\s+/g, ''); // strip display spaces from Gmail app passwords
const SMTP_FROM   = process.env.SMTP_FROM  || SMTP_USER;
const ALERT_EMAIL = (process.env.ALERT_EMAIL || '').split(',').map(e => e.trim()).filter(Boolean);

function isConfigured() {
    return !!(nodemailer && SMTP_HOST && SMTP_USER && SMTP_PASS && ALERT_EMAIL.length);
}

let _transport = null;
function getTransport() {
    if (!_transport) {
        _transport = nodemailer.createTransport({
            host: SMTP_HOST, port: SMTP_PORT,
            secure: SMTP_PORT === 465,
            auth: { user: SMTP_USER, pass: SMTP_PASS },
        });
    }
    return _transport;
}

async function send(subject, html) {
    if (!isConfigured()) {
        console.log(`📧 [SKIP] Email not configured — would have sent: "${subject}"`);
        return { sent: false, reason: 'not_configured' };
    }
    console.log(`📧 [SENDING] ${subject}`);
    try {
        const info = await getTransport().sendMail({
            from: `"Saving Bot" <${SMTP_FROM}>`,
            to:   ALERT_EMAIL.join(', '),
            subject, html,
        });
        console.log(`📧 [OK] Delivered → ${info.accepted.join(', ')} (messageId: ${info.messageId})`);
        return { sent: true, messageId: info.messageId };
    } catch (err) {
        console.error(`📧 [FAIL] ${err.message}`);
        return { sent: false, reason: err.message };
    }
}

// ── SMTP connectivity test — called on bot startup ────────────────────────────
async function testSmtp() {
    if (!isConfigured()) {
        console.log('📧 [SMTP] Not configured — skipping connectivity test.');
        console.log('   Set SMTP_HOST, SMTP_USER, SMTP_PASS, ALERT_EMAIL in .env to enable email alerts.');
        return;
    }
    console.log(`📧 [SMTP] Testing connection to ${SMTP_HOST}:${SMTP_PORT}...`);
    try {
        await getTransport().verify();
        console.log('📧 [SMTP] Connection OK — sending startup test email...');
    } catch (err) {
        console.error(`📧 [SMTP] Connection FAILED: ${err.message}`);
        console.error('   Check SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS in .env');
        return;
    }

    const html = buildServiceHtml('#0284c7', '🧪', 'SMTP Test — Saving Bot Started', [
        ['Status',  'Email delivery is working',  '#0f766e'],
        ['SMTP',    `${SMTP_HOST}:${SMTP_PORT}`,  '#0f172a'],
        ['From',    SMTP_FROM,                    '#0f172a'],
        ['To',      ALERT_EMAIL.join(', '),        '#0f172a'],
        ['Time',    ts() + ' PKT',                '#0f172a'],
        ['Info',    'You will receive alerts for data changes and service events.', '#64748b'],
    ]);
    const result = await send('🧪 Saving Bot: SMTP Test — Startup OK', html);
    if (result.sent) {
        console.log('📧 [SMTP] Test email delivered successfully.');
    } else {
        console.error(`📧 [SMTP] Test email failed: ${result.reason}`);
    }
}

const N   = n => (n || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const ts  = () => new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });

// ─── Email shell ──────────────────────────────────────────────────────────────
function shell(accent, headerHtml, bodyHtml) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Saving Bot</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%">
  <tr><td style="background:${accent};border-radius:12px 12px 0 0;padding:24px 28px">${headerHtml}</td></tr>
  <tr><td style="background:#ffffff;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0">${bodyHtml}</td></tr>
  <tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:14px 28px;text-align:center">
    <span style="font-size:11px;color:#94a3b8">Saving Bot v0.1 &nbsp;·&nbsp; ${ts()} PKT &nbsp;·&nbsp; Automated Alert</span>
  </td></tr>
</table></td></tr></table></body></html>`;
}

// ─── Stat cards ───────────────────────────────────────────────────────────────
function statCards(cards) {
    const pct = Math.floor(100 / cards.length);
    const cols = cards.map(({ label, value, color }) =>
        `<td width="${pct}%" style="text-align:center;padding:18px 8px;border-right:1px solid #f1f5f9">
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;margin-bottom:5px">${label}</div>
          <div style="font-size:20px;font-weight:700;color:${color||'#0f172a'}">${value}</div>
        </td>`).join('');
    return `<table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:2px solid #f1f5f9"><tr>${cols}</tr></table>`;
}

// ─── Header helper ────────────────────────────────────────────────────────────
function hdr(icon, title, sub) {
    return `<table cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:34px;padding-right:14px;vertical-align:middle">${icon}</td>
      <td><div style="color:#fff;font-size:19px;font-weight:700;margin-bottom:2px">${title}</div>
          <div style="color:rgba(255,255,255,.72);font-size:13px">${sub}</div></td>
    </tr></table>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE / DELETE / REPLACE / APPEND ALERT
// ─────────────────────────────────────────────────────────────────────────────
const ACTION_META = {
    appended: { color: '#0f766e', label: 'Value Appended', icon: '📎' },
    deleted:  { color: '#dc2626', label: 'Value Deleted',  icon: '🗑️' },
    changed:  { color: '#d97706', label: 'Value Changed',  icon: '✏️' },
    replaced: { color: '#7c3aed', label: 'Value Replaced', icon: '🔄' },
};

function buildChangeHtml(action, details, isBudget) {
    const { color, label, icon } = ACTION_META[action] || { color: '#374151', label: action, icon: '📝' };
    const { phone, oldValue, newValue, formula } = details;

    const locRows = isBudget
        ? [['🏦 Field',    details.budget_field],
           ['📅 Month',    `${details.budget_month} 2026`]]
        : [['📂 Section',  details.section],
           ['🏷️ Category', details.category],
           ['📅 Month',    `${details.month} 2026`],
           ['📆 Day',      String(details.day)]];

    const cards = statCards([
        { label: 'Old Value', value: oldValue != null ? `PKR ${oldValue}` : '—', color: '#64748b' },
        { label: 'New Value', value: newValue != null ? `PKR ${newValue}` : '—', color },
    ]);

    const detailRows = [...locRows, ['📱 Changed By', phone]]
        .map(([k, v]) =>
            `<tr><td style="padding:10px 28px;width:130px;color:#64748b;font-size:13px;border-bottom:1px solid #f8fafc;white-space:nowrap">${k}</td>
                 <td style="padding:10px 28px;color:#0f172a;font-size:13px;font-weight:600;border-bottom:1px solid #f8fafc">${v}</td></tr>`
        ).join('');

    const formulaBlock = formula
        ? `<tr><td colspan="2" style="padding:4px 28px 20px"><div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px">
            <span style="font-size:10px;color:#16a34a;font-weight:700;letter-spacing:.6px">FORMULA</span>
            <div style="font-family:monospace;font-size:14px;color:#0f172a;margin-top:4px">= ${formula}</div>
           </div></td></tr>`
        : '';

    const body = `${cards}<table width="100%" cellpadding="0" cellspacing="0">${detailRows}${formulaBlock}</table>`;
    return shell(color, hdr(icon, label, 'Saving Bot — Data Change Alert'), body);
}

async function alertDataChange(action, details) {
    const { icon, label } = ACTION_META[action] || { icon: '📝', label: action };
    await send(
        `${icon} Saving Bot: ${label} — ${details.section} › ${details.category} (Day ${details.day})`,
        buildChangeHtml(action, details, false)
    );
}

async function alertBudgetChange(action, details) {
    const { icon, label } = ACTION_META[action] || { icon: '📝', label: action };
    await send(
        `${icon} Saving Bot: Budget ${label} — ${details.budget_field} (${details.budget_month})`,
        buildChangeHtml(action, details, true)
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// DAY-END SPENDING REPORT
// ─────────────────────────────────────────────────────────────────────────────
const SECTION_COLORS = {
    'INCOME':           '#16a34a',
    'Petty Cash Used':  '#7c3aed',
    'SAVINGS EXPENSE':  '#0284c7',
    'HOME EXPENSES':    '#ea580c',
    'DAILY LIVING':     '#0f766e',
    'CHILDREN':         '#db2777',
    'TRANSPORTATION':   '#d97706',
    'HEALTH':           '#dc2626',
    'EDUCATION':        '#7c3aed',
    'CHARITY/GIFTS':    '#16a34a',
    'OBLIGATIONS':      '#b91c1c',
    'ENTERTAINMENT':    '#0891b2',
    'SUBSCRIPTIONS':    '#6d28d9',
    'VACATION':         '#0369a1',
    'MISCELLANEOUS':    '#6b7280',
};

function buildDayEndHtml(report) {
    const { date, sections, pettyCashTotal, bankTotal, incomeTotal, grandExpenses } = report;

    const cards = statCards([
        { label: 'Total Spent',  value: `PKR ${N(grandExpenses)}`, color: '#dc2626' },
        { label: 'Bank',         value: `PKR ${N(bankTotal)}`,     color: '#0f766e' },
        { label: 'Petty Cash',   value: `PKR ${N(pettyCashTotal)}`, color: '#7c3aed' },
        ...(incomeTotal > 0 ? [{ label: 'Income', value: `PKR ${N(incomeTotal)}`, color: '#16a34a' }] : []),
    ]);

    const sectionBlocks = sections
        .filter(s => s.total > 0)
        .sort((a, b) => a.name === 'INCOME' ? -1 : b.name === 'INCOME' ? 1 : b.total - a.total)
        .map(section => {
            const color = SECTION_COLORS[section.name] || '#374151';
            const itemRows = section.items
                .sort((a, b) => b.value - a.value)
                .map(item => {
                    const fmlHtml = item.hasFormula && item.parts.length > 1
                        ? `<div style="font-family:monospace;font-size:11px;color:#94a3b8;margin-top:2px">= ${item.parts.map(N).join(' + ')}</div>`
                        : '';
                    return `<tr>
                      <td style="padding:9px 0 9px 14px;border-bottom:1px solid #f8fafc;font-size:13px;color:#374151">
                        ${item.category}${fmlHtml}</td>
                      <td style="padding:9px 14px 9px 0;border-bottom:1px solid #f8fafc;text-align:right;font-size:13px;font-weight:600;color:${color};white-space:nowrap">
                        PKR ${N(item.value)}</td>
                    </tr>`;
                }).join('');

            return `<div style="margin:0 28px 18px;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td colspan="2" style="background:${color};padding:9px 14px">
                  <table width="100%" cellpadding="0" cellspacing="0"><tr>
                    <td style="color:#fff;font-size:12px;font-weight:700;letter-spacing:.3px">${section.name}</td>
                    <td style="color:rgba(255,255,255,.85);font-size:12px;font-weight:600;text-align:right">PKR ${N(section.total)}</td>
                  </tr></table>
                </td></tr>
                <tr><td colspan="2" style="background:#fff">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    ${itemRows}
                    <tr>
                      <td style="padding:10px 0 10px 14px;font-size:13px;font-weight:700;color:${color}">Total</td>
                      <td style="padding:10px 14px 10px 0;text-align:right;font-size:14px;font-weight:700;color:${color}">PKR ${N(section.total)}</td>
                    </tr>
                  </table>
                </td></tr>
              </table>
            </div>`;
        }).join('');

    const grandBar = `<div style="margin:4px 28px 24px;background:#0f172a;border-radius:10px;padding:14px 20px">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="color:#e2e8f0;font-size:14px;font-weight:700">Grand Total Spent</td>
        <td style="color:#f87171;font-size:20px;font-weight:700;text-align:right">PKR ${N(grandExpenses)}</td>
      </tr></table></div>`;

    const body = `${cards}<div style="height:22px"></div>${sectionBlocks}${grandBar}`;
    return shell('#0f172a', hdr('📊', `Daily Spending Report`, date), body);
}

async function sendDayEndReport(report) {
    if (!report || !report.hasData) {
        console.log('📧 Day-end report: no spending today, skipping.');
        return;
    }
    await send(
        `📊 Saving Bot: Daily Report — ${report.date} | PKR ${N(report.grandExpenses)} spent`,
        buildDayEndHtml(report)
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE ALERTS
// ─────────────────────────────────────────────────────────────────────────────
function buildServiceHtml(color, icon, title, rows) {
    const rowsHtml = rows.map(([k, v, vc]) =>
        `<tr><td style="padding:11px 28px;width:110px;color:#64748b;font-size:13px;border-bottom:1px solid #f8fafc;white-space:nowrap">${k}</td>
             <td style="padding:11px 28px;color:${vc||'#0f172a'};font-size:13px;font-weight:600;border-bottom:1px solid #f8fafc">${v}</td></tr>`
    ).join('');
    return shell(color, hdr(icon, title, 'Saving Bot — Service Alert'),
        `<table width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>`);
}

async function alertBotOnline() {
    await send('✅ Saving Bot: Online & Ready',
        buildServiceHtml('#0f766e', '✅', 'Bot is Online', [
            ['Status',  'Connected & Ready', '#0f766e'],
            ['Time',    ts() + ' PKT',       '#0f172a'],
            ['Info',    'All systems operational', '#64748b'],
        ]));
}

async function alertBotDown(reason) {
    await send('🔴 Saving Bot: SERVICE DOWN',
        buildServiceHtml('#dc2626', '🔴', 'Service Down — Bot Disconnected', [
            ['Status',  'OFFLINE',           '#dc2626'],
            ['Reason',  reason || 'Unknown', '#0f172a'],
            ['Time',    ts() + ' PKT',       '#0f172a'],
            ['Action',  'Bot will auto-restart (docker restart=unless-stopped)', '#64748b'],
        ]));
}

async function alertAuthFailure(msg) {
    await send('🔐 Saving Bot: Auth Failure — Re-scan QR',
        buildServiceHtml('#dc2626', '🔐', 'Authentication Failed', [
            ['Status',  'Auth Failure',         '#dc2626'],
            ['Detail',  String(msg || 'Unknown'), '#0f172a'],
            ['Time',    ts() + ' PKT',           '#0f172a'],
            ['Fix',     'Delete ./session and re-scan QR code', '#64748b'],
        ]));
}

module.exports = {
    isConfigured,
    testSmtp,
    alertDataChange,
    alertBudgetChange,
    sendDayEndReport,
    alertBotOnline,
    alertBotDown,
    alertAuthFailure,
};