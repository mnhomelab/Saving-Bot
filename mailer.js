'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// MAILER — Dark-mode HTML email alerts matching dashboard aesthetic
// Colors: bg=#0a0f1e  surface=#111827  surface2=#1a2235
//         accent=#0f766e  text=#e2e8f0  muted=#64748b
//         green=#4ade80  red=#f87171  blue=#60a5fa  yellow=#fbbf24
// ─────────────────────────────────────────────────────────────────────────────

let nodemailer;
try { nodemailer = require('nodemailer'); }
catch { nodemailer = null; }

// ── Lazy env readers ──────────────────────────────────────────────────────────
const cfg = {
    get host()  { return process.env.SMTP_HOST  || ''; },
    get port()  { return parseInt(process.env.SMTP_PORT || '587', 10); },
    get user()  { return process.env.SMTP_USER  || ''; },
    get pass()  { return (process.env.SMTP_PASS || '').replace(/\s+/g, ''); },
    get from()  { return process.env.SMTP_FROM  || process.env.SMTP_USER || ''; },
    get to()    { return (process.env.ALERT_EMAIL || '').split(',').map(e => e.trim()).filter(Boolean); },
};

function isConfigured() {
    return !!(nodemailer && cfg.host && cfg.user && cfg.pass && cfg.to.length);
}

let _transport = null, _transportKey = '';
function getTransport() {
    const key = `${cfg.host}:${cfg.port}:${cfg.user}`;
    if (!_transport || _transportKey !== key) {
        _transport    = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465, auth: { user: cfg.user, pass: cfg.pass } });
        _transportKey = key;
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
        const info = await getTransport().sendMail({ from: `"Saving Bot" <${cfg.from}>`, to: cfg.to.join(', '), subject, html });
        console.log(`📧 [OK] Delivered → ${info.accepted.join(', ')} (${info.messageId})`);
        return { sent: true };
    } catch (err) {
        console.error(`📧 [FAIL] ${err.message}`);
        return { sent: false, reason: err.message };
    }
}

// ── Formatters ────────────────────────────────────────────────────────────────
const N  = n => (n || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const ts = () => new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' });

// ─────────────────────────────────────────────────────────────────────────────
// DARK EMAIL SHELL
// ─────────────────────────────────────────────────────────────────────────────
function shell(accentColor, headerHtml, bodyHtml, footerExtra) {
    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>Saving Bot Alert</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#0a0f1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif" bgcolor="#0a0f1e">

<!-- OUTER WRAPPER -->
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0a0f1e;min-height:100vh" bgcolor="#0a0f1e">
<tr><td align="center" style="padding:32px 16px">

<!-- CARD -->
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%">

  <!-- TOP ACCENT BAR -->
  <tr><td height="3" style="background:linear-gradient(90deg,${accentColor} 0%,#0f766e 50%,#1e40af 100%);border-radius:12px 12px 0 0;font-size:0;line-height:0" bgcolor="${accentColor}"></td></tr>

  <!-- HEADER -->
  <tr><td style="background-color:#111827;padding:28px 32px 24px;border-left:1px solid #1e293b;border-right:1px solid #1e293b" bgcolor="#111827">
    ${headerHtml}
  </td></tr>

  <!-- DIVIDER -->
  <tr><td height="1" style="background:linear-gradient(90deg,transparent,${accentColor}40,transparent);font-size:0;line-height:0"></td></tr>

  <!-- BODY -->
  <tr><td style="background-color:#0d1424;border-left:1px solid #1e293b;border-right:1px solid #1e293b" bgcolor="#0d1424">
    ${bodyHtml}
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background-color:#111827;border:1px solid #1e293b;border-top:1px solid #1e293b;border-radius:0 0 12px 12px;padding:16px 32px" bgcolor="#111827">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="color:#4b5563;font-size:11px">
        <span style="color:#0f766e;font-weight:700">💰 Saving Bot</span>
        &nbsp;·&nbsp; v0.1 &nbsp;·&nbsp; ${ts()} PKT
        ${footerExtra ? `&nbsp;·&nbsp; ${footerExtra}` : ''}
      </td>
      <td align="right" style="color:#1e293b;font-size:11px">Automated Alert</td>
    </tr></table>
  </td></tr>

</table>
<!-- END CARD -->

</td></tr></table>
</body></html>`;
}

// ── Header block ──────────────────────────────────────────────────────────────
function header(icon, title, subtitle, accentColor) {
    return `<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td width="56" valign="middle">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,${accentColor}33,${accentColor}11);border:1px solid ${accentColor}44;border-radius:12px;text-align:center;line-height:48px;font-size:24px">${icon}</div>
      </td>
      <td valign="middle" style="padding-left:16px">
        <div style="color:#e2e8f0;font-size:20px;font-weight:700;letter-spacing:-.3px;margin-bottom:3px">${title}</div>
        <div style="color:#64748b;font-size:13px">${subtitle}</div>
      </td>
      <td align="right" valign="middle">
        <div style="display:inline-block;background:${accentColor}22;border:1px solid ${accentColor}44;border-radius:20px;padding:4px 12px;font-size:11px;color:${accentColor};font-weight:600;letter-spacing:.3px;white-space:nowrap">SAVING BOT</div>
      </td>
    </tr></table>`;
}

// ── Stat cards row ────────────────────────────────────────────────────────────
function statCards(cards) {
    const pct = Math.floor(100 / cards.length);
    const cols = cards.map(({ label, value, color }, i) =>
        `<td width="${pct}%" style="text-align:center;padding:20px 8px;${i < cards.length - 1 ? 'border-right:1px solid #1e293b;' : ''}vertical-align:top">
          <div style="font-size:10px;color:#4b5563;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;font-weight:600">${label}</div>
          <div style="font-size:22px;font-weight:700;color:${color || '#e2e8f0'};letter-spacing:-.5px">${value}</div>
        </td>`
    ).join('');
    return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #1e293b"><tr>${cols}</tr></table>`;
}

// ── Data row ──────────────────────────────────────────────────────────────────
function row(label, value, valueColor) {
    return `<tr>
      <td style="padding:11px 32px;color:#4b5563;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;width:140px;border-bottom:1px solid #1a2235;white-space:nowrap">${label}</td>
      <td style="padding:11px 32px;color:${valueColor || '#e2e8f0'};font-size:14px;font-weight:500;border-bottom:1px solid #1a2235">${value}</td>
    </tr>`;
}

// ── Formula pill ──────────────────────────────────────────────────────────────
function formulaPill(formula) {
    if (!formula) return '';
    return `<tr><td colspan="2" style="padding:0 32px 16px">
      <div style="background:#0a1a0f;border:1px solid #0f766e33;border-left:3px solid #0f766e;border-radius:0 6px 6px 0;padding:10px 16px">
        <div style="font-size:10px;color:#0f766e;font-weight:700;letter-spacing:1px;margin-bottom:6px">FORMULA</div>
        <div style="font-family:'Courier New',Courier,monospace;font-size:14px;color:#4ade80;letter-spacing:.3px">= ${formula}</div>
      </div>
    </td></tr>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION META
// ─────────────────────────────────────────────────────────────────────────────
const ACTION_META = {
    added:    { color: '#60a5fa', label: 'Value Added',    icon: '➕' },
    appended: { color: '#4ade80', label: 'Value Appended', icon: '📎' },
    deleted:  { color: '#f87171', label: 'Value Deleted',  icon: '🗑️' },
    changed:  { color: '#fbbf24', label: 'Value Changed',  icon: '✏️' },
    replaced: { color: '#c084fc', label: 'Value Replaced', icon: '🔄' },
};

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE / ADD / DELETE / REPLACE / APPEND ALERT
// ─────────────────────────────────────────────────────────────────────────────

// Renders a parts list as a formula string with individual values visible
function partsList(parts) {
    if (!parts || parts.length === 0) return '<span style="color:#4b5563;font-style:italic">empty</span>';
    return parts.map((v, i) =>
        `<span style="display:inline-block;background:#1a2235;border:1px solid #2d3f5e;border-radius:4px;padding:2px 8px;margin:2px;font-family:'Courier New',monospace;font-size:13px;color:#60a5fa">${N(v)}</span>`
    ).join('<span style="color:#4b5563;font-size:12px;padding:0 2px">+</span>');
}

function beforeAfterBlock(beforeParts, beforeTotal, afterParts, afterTotal, accentColor) {
    const hasBefore = beforeParts && beforeParts.length > 0;
    const hasAfter  = afterParts  && afterParts.length  > 0;
    return `
    <div style="margin:0 32px 16px">
      <!-- BEFORE -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px">
        <tr>
          <td width="60" style="padding-right:12px;vertical-align:top;padding-top:4px">
            <div style="background:#1e293b;border:1px solid #374151;border-radius:6px;padding:4px 8px;font-size:10px;font-weight:700;color:#64748b;text-align:center;letter-spacing:.5px">BEFORE</div>
          </td>
          <td style="background:#111827;border:1px solid #1e293b;border-radius:8px;padding:12px 14px">
            ${hasBefore
                ? `<div style="margin-bottom:6px">${partsList(beforeParts)}</div>
                   <div style="font-size:11px;color:#4b5563">Total: <span style="color:#94a3b8;font-weight:600">PKR ${N(beforeTotal)}</span></div>`
                : `<span style="color:#4b5563;font-style:italic;font-size:13px">No previous value</span>`}
          </td>
        </tr>
      </table>
      <!-- ARROW -->
      <div style="text-align:center;font-size:18px;color:${accentColor};margin:2px 0">↓</div>
      <!-- AFTER -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px">
        <tr>
          <td width="60" style="padding-right:12px;vertical-align:top;padding-top:4px">
            <div style="background:${accentColor}22;border:1px solid ${accentColor}44;border-radius:6px;padding:4px 8px;font-size:10px;font-weight:700;color:${accentColor};text-align:center;letter-spacing:.5px">AFTER</div>
          </td>
          <td style="background:#0a1424;border:1px solid ${accentColor}33;border-radius:8px;padding:12px 14px">
            ${hasAfter
                ? `<div style="margin-bottom:6px">${partsList(afterParts)}</div>
                   <div style="font-size:11px;color:#4b5563">Total: <span style="color:${accentColor};font-weight:700">PKR ${N(afterTotal)}</span></div>`
                : `<span style="color:#f87171;font-style:italic;font-size:13px">Cell cleared</span>`}
          </td>
        </tr>
      </table>
    </div>`;
}

function changeDetailBlock(action, details, color) {
    const d = details;
    if (action === 'added') {
        return `<div style="margin:0 32px 16px;background:#0a1a2e;border:1px solid ${color}33;border-left:3px solid ${color};border-radius:0 8px 8px 0;padding:12px 16px">
          <div style="font-size:10px;color:${color};font-weight:700;letter-spacing:1px;margin-bottom:6px">NEW ENTRY</div>
          <div style="font-size:22px;font-weight:800;color:${color}">PKR ${N(d.newValue)}</div>
          <div style="font-size:11px;color:#4b5563;margin-top:4px">First value recorded for this cell</div>
        </div>`;
    }
    if (action === 'appended') {
        return `<div style="margin:0 32px 16px;background:#0a1a2e;border:1px solid ${color}33;border-left:3px solid ${color};border-radius:0 8px 8px 0;padding:12px 16px">
          <div style="font-size:10px;color:${color};font-weight:700;letter-spacing:1px;margin-bottom:8px">APPENDED VALUE</div>
          <div style="font-size:20px;font-weight:700;color:${color}">+ PKR ${N(d.appendedValue)}</div>
          <div style="font-size:11px;color:#4b5563;margin-top:4px">Added to formula · New total: <span style="color:${color};font-weight:600">PKR ${N(d.newTotal)}</span></div>
        </div>`;
    }
    if (action === 'deleted') {
        return `<div style="margin:0 32px 16px;background:#1a0a0a;border:1px solid #f8717133;border-left:3px solid #f87171;border-radius:0 8px 8px 0;padding:12px 16px">
          <div style="font-size:10px;color:#f87171;font-weight:700;letter-spacing:1px;margin-bottom:8px">REMOVED PART ${d.deletedIndex}</div>
          <div style="font-size:20px;font-weight:700;color:#f87171;text-decoration:line-through">PKR ${N(d.deletedValue)}</div>
          <div style="font-size:11px;color:#4b5563;margin-top:4px">
            ${d.newParts && d.newParts.length > 0
                ? `Remaining: <span style="color:#94a3b8;font-weight:600">PKR ${N(d.newTotal)}</span>`
                : 'Cell has been cleared'}
          </div>
        </div>`;
    }
    if (action === 'changed') {
        return `<div style="margin:0 32px 16px;background:#1a140a;border:1px solid #fbbf2433;border-left:3px solid #fbbf24;border-radius:0 8px 8px 0;padding:12px 16px">
          <div style="font-size:10px;color:#fbbf24;font-weight:700;letter-spacing:1px;margin-bottom:8px">PART ${d.changedIndex} MODIFIED</div>
          <div style="font-size:14px;font-weight:600">
            <span style="color:#f87171;text-decoration:line-through">PKR ${N(d.oldPartValue)}</span>
            <span style="color:#4b5563;padding:0 8px">→</span>
            <span style="color:#fbbf24">PKR ${N(d.newPartValue)}</span>
          </div>
          <div style="font-size:11px;color:#4b5563;margin-top:4px">New total: <span style="color:#fbbf24;font-weight:600">PKR ${N(d.newTotal)}</span></div>
        </div>`;
    }
    if (action === 'replaced') {
        return `<div style="margin:0 32px 16px;background:#140a1a;border:1px solid #c084fc33;border-left:3px solid #c084fc;border-radius:0 8px 8px 0;padding:12px 16px">
          <div style="font-size:10px;color:#c084fc;font-weight:700;letter-spacing:1px;margin-bottom:8px">FULL REPLACEMENT</div>
          <div style="font-size:14px;font-weight:600">
            <span style="color:#f87171;text-decoration:line-through">PKR ${N(d.oldValue)}</span>
            <span style="color:#4b5563;padding:0 8px">→</span>
            <span style="color:#c084fc;font-size:20px">PKR ${N(d.newValue)}</span>
          </div>
          <div style="font-size:11px;color:#4b5563;margin-top:4px">Entire formula replaced with single value</div>
        </div>`;
    }
    return '';
}

function buildChangeHtml(action, details, isBudget) {
    const { color, label, icon } = ACTION_META[action] || { color: '#64748b', label: action, icon: '📝' };
    const { phone, before, after } = details;

    const locRows = isBudget
        ? [['🏦 Field',    details.budget_field, '#e2e8f0'],
           ['📅 Month',    `${details.budget_month} 2026`, '#e2e8f0']]
        : [['📂 Section',  details.section,  '#94a3b8'],
           ['🏷️ Category', details.category, color],
           ['📅 Month',    `${details.month} 2026`, '#e2e8f0'],
           ['📆 Day',      String(details.day), '#e2e8f0']];

    const bodyHtml = `
      <!-- Action badge -->
      <div style="padding:16px 32px 0">
        <div style="display:inline-block;background:${color}22;border:1px solid ${color}55;border-radius:20px;padding:6px 16px;font-size:12px;font-weight:700;color:${color};letter-spacing:.5px">${icon} ${label.toUpperCase()}</div>
      </div>

      <!-- Location -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 4px">
        ${locRows.map(([l, v, c]) => row(l, v, c)).join('')}
        ${row('📱 Changed By', phone, '#94a3b8')}
      </table>

      <!-- Divider -->
      <div style="height:1px;background:linear-gradient(90deg,transparent,${color}33,transparent);margin:4px 0 16px"></div>

      <!-- Change detail block -->
      ${changeDetailBlock(action, details, color)}

      <!-- Before / After comparison -->
      ${(before || after) ? beforeAfterBlock(before?.parts, before?.total, after?.parts, after?.total, color) : ''}

      <div style="height:8px"></div>`;

    const hdr = header(icon, label, isBudget ? 'Budget Update Alert' : 'Expense Tracker Alert', color);
    return shell(color, hdr, bodyHtml);
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
    'INCOME':           '#4ade80',
    'Petty Cash Used':  '#c084fc',
    'SAVINGS EXPENSE':  '#60a5fa',
    'HOME EXPENSES':    '#fb923c',
    'DAILY LIVING':     '#2dd4bf',
    'CHILDREN':         '#f472b6',
    'TRANSPORTATION':   '#fbbf24',
    'HEALTH':           '#f87171',
    'EDUCATION':        '#a78bfa',
    'CHARITY/GIFTS':    '#34d399',
    'OBLIGATIONS':      '#f87171',
    'ENTERTAINMENT':    '#22d3ee',
    'SUBSCRIPTIONS':    '#818cf8',
    'VACATION':         '#38bdf8',
    'MISCELLANEOUS':    '#94a3b8',
};

function buildDayEndHtml(report) {
    const { date, sections, pettyCashTotal, bankTotal, incomeTotal, grandExpenses } = report;

    const cards = statCards([
        { label: 'Total Spent',  value: `PKR ${N(grandExpenses)}`, color: '#f87171' },
        { label: 'Bank',         value: `PKR ${N(bankTotal)}`,     color: '#2dd4bf' },
        { label: 'Petty Cash',   value: `PKR ${N(pettyCashTotal)}`, color: '#c084fc' },
        ...(incomeTotal > 0 ? [{ label: 'Income', value: `PKR ${N(incomeTotal)}`, color: '#4ade80' }] : []),
    ]);

    const sectionBlocks = sections
        .filter(s => s.total > 0)
        .sort((a, b) => a.name === 'INCOME' ? -1 : b.name === 'INCOME' ? 1 : b.total - a.total)
        .map(section => {
            const color = SECTION_COLORS[section.name] || '#94a3b8';
            const items = section.items
                .sort((a, b) => b.value - a.value)
                .map(item => {
                    const fml = item.hasFormula && item.parts.length > 1
                        ? `<div style="font-family:'Courier New',monospace;font-size:10px;color:#0f766e;margin-top:3px">= ${item.parts.map(N).join(' + ')}</div>`
                        : '';
                    return `<tr>
                      <td style="padding:10px 16px;border-bottom:1px solid #0d1424;font-size:13px;color:#94a3b8">${item.category}${fml}</td>
                      <td style="padding:10px 16px;border-bottom:1px solid #0d1424;text-align:right;font-size:13px;font-weight:600;color:${color};white-space:nowrap">PKR ${N(item.value)}</td>
                    </tr>`;
                }).join('');

            return `<div style="margin:0 24px 16px;border-radius:10px;overflow:hidden;border:1px solid ${color}22">
              <!-- Section header -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(90deg,${color}22,${color}08)">
                <tr>
                  <td style="padding:10px 16px;font-size:11px;font-weight:700;color:${color};letter-spacing:.5px;text-transform:uppercase">${section.name}</td>
                  <td style="padding:10px 16px;text-align:right;font-size:13px;font-weight:700;color:${color}">PKR ${N(section.total)}</td>
                </tr>
              </table>
              <!-- Items -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#111827">
                ${items}
                <tr>
                  <td style="padding:10px 16px;font-size:12px;font-weight:700;color:${color}">Subtotal</td>
                  <td style="padding:10px 16px;text-align:right;font-size:14px;font-weight:700;color:${color}">PKR ${N(section.total)}</td>
                </tr>
              </table>
            </div>`;
        }).join('');

    // Grand total
    const grandBar = `<div style="margin:8px 24px 24px;background:linear-gradient(135deg,#0f766e22,#1e40af22);border:1px solid #0f766e44;border-radius:10px;padding:18px 20px">
      <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="color:#e2e8f0;font-size:14px;font-weight:700">💰 Grand Total Spent</td>
        <td style="text-align:right">
          <span style="font-size:24px;font-weight:800;color:#f87171;letter-spacing:-.5px">PKR ${N(grandExpenses)}</span>
        </td>
      </tr></table>
    </div>`;

    const bodyHtml = `${cards}<div style="height:20px"></div>${sectionBlocks}${grandBar}`;
    const hdr = header('📊', `Daily Spending Report`, date, '#0f766e');
    return shell('#0f766e', hdr, bodyHtml, `${sections.filter(s=>s.total>0).length} sections`);
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
function buildServiceHtml(color, icon, title, subtitle, rows) {
    const rowsHtml = rows.map(([l, v, vc]) => row(l, v, vc || '#e2e8f0')).join('');
    return shell(color,
        header(icon, title, subtitle, color),
        `<table width="100%" cellpadding="0" cellspacing="0" border="0">${rowsHtml}</table>`
    );
}

async function alertBotOnline() {
    await send('✅ Saving Bot: Online & Ready',
        buildServiceHtml('#4ade80', '✅', 'Bot is Online', 'Service Status Alert', [
            ['Status',  '● Connected & Ready', '#4ade80'],
            ['Host',    cfg.host || 'localhost', '#e2e8f0'],
            ['Time',    ts() + ' PKT', '#94a3b8'],
            ['Info',    'All systems operational. Email alerts are active.', '#64748b'],
        ]));
}

async function alertBotDown(reason) {
    await send('🔴 Saving Bot: SERVICE DOWN',
        buildServiceHtml('#f87171', '🔴', 'Service Offline', 'Critical Service Alert', [
            ['Status',  '● OFFLINE', '#f87171'],
            ['Reason',  reason || 'Unknown', '#fbbf24'],
            ['Time',    ts() + ' PKT', '#94a3b8'],
            ['Action',  'Bot will auto-restart (restart: unless-stopped)', '#64748b'],
        ]));
}

async function alertAuthFailure(msg) {
    await send('🔐 Saving Bot: Auth Failure',
        buildServiceHtml('#fbbf24', '🔐', 'Authentication Failed', 'WhatsApp Session Alert', [
            ['Status',  '● Auth Failure', '#f87171'],
            ['Detail',  String(msg || 'Unknown'), '#fbbf24'],
            ['Time',    ts() + ' PKT', '#94a3b8'],
            ['Fix',     'Delete ./session folder and re-scan QR code', '#64748b'],
        ]));
}

// ─────────────────────────────────────────────────────────────────────────────
// SMTP TEST
// ─────────────────────────────────────────────────────────────────────────────
async function testSmtp() {
    const diag = [
        ['SMTP_HOST',   cfg.host  || null,                             'smtp.gmail.com'],
        ['SMTP_PORT',   cfg.host  ? String(cfg.port) : null,           '587'],
        ['SMTP_USER',   cfg.user  || null,                             'your@gmail.com'],
        ['SMTP_PASS',   cfg.pass  ? `set (${cfg.pass.length} chars)` : null, '16-char app password'],
        ['ALERT_EMAIL', cfg.to.length ? cfg.to.join(', ') : null,      'recipient@gmail.com'],
        ['nodemailer',  nodemailer ? 'installed' : null,               'npm install nodemailer'],
    ];
    console.log('📧 [SMTP] Config diagnostic:');
    diag.forEach(([k, v, hint]) => {
        if (v) console.log(`   ✅  ${k.padEnd(14)} = ${v}`);
        else   console.log(`   ❌  ${k.padEnd(14)} — NOT SET  (hint: ${hint})`);
    });

    if (!isConfigured()) {
        console.log('📧 [SMTP] Not configured — email alerts disabled.');
        console.log('   Add the missing vars above to your .env file and restart.');
        return;
    }

    console.log(`📧 [SMTP] Testing connection to ${cfg.host}:${cfg.port}...`);
    try {
        await getTransport().verify();
        console.log('📧 [SMTP] Connection OK — sending startup test email...');
    } catch (err) {
        console.error(`📧 [SMTP] Connection FAILED: ${err.message}`);
        return;
    }

    const html = buildServiceHtml('#60a5fa', '🧪', 'SMTP Test Successful', 'Startup Connectivity Check', [
        ['Status',  '● Email delivery working', '#4ade80'],
        ['SMTP',    `${cfg.host}:${cfg.port}`,  '#e2e8f0'],
        ['From',    cfg.from,                   '#e2e8f0'],
        ['To',      cfg.to.join(', '),           '#60a5fa'],
        ['Time',    ts() + ' PKT',              '#94a3b8'],
        ['Info',    'You will receive alerts for all data changes and service events.', '#64748b'],
    ]);
    const result = await send('🧪 Saving Bot: SMTP Test — Startup OK', html);
    if (result.sent) console.log('📧 [SMTP] Test email delivered successfully.');
    else console.error(`📧 [SMTP] Test email failed: ${result.reason}`);
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