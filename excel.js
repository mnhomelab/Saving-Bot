'use strict';

const ExcelJS = require('exceljs');
const { getExcelPath } = require('./config');

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_DAYS = {
    Jan:31, Feb:28, Mar:31, Apr:30, May:31, Jun:30,
    Jul:31, Aug:31, Sep:30, Oct:31, Nov:30, Dec:31
};

const ROW_MAP = {
    "INCOME|Wages & Tips":5, "INCOME|Interest Income":6, "INCOME|Dividends":7,
    "INCOME|Gifts Received":8, "INCOME|Refunds/Reimbursements":9,
    "INCOME|Other":10, "INCOME|Transfer From Savings":11,
    "Petty Cash Used|Pocket Money Wife":15, "Petty Cash Used|Car Part":16,
    "Petty Cash Used|Food":17, "Petty Cash Used|Donation":18,
    "Petty Cash Used|Eidi":19, "Petty Cash Used|Other":22,
    "SAVINGS EXPENSE|Emergency Fund":26, "SAVINGS EXPENSE|Investments":27,
    "SAVINGS EXPENSE|Pocket Money Wife":28,
    "HOME EXPENSES|Mortgage/Rent":34, "HOME EXPENSES|Electricity":35,
    "HOME EXPENSES|Gas/Oil":36, "HOME EXPENSES|Water/Sewer/Trash":37,
    "HOME EXPENSES|Phone":38, "HOME EXPENSES|Cable/Satellite":39,
    "HOME EXPENSES|Internet":40, "HOME EXPENSES|Furnishings/Appliances":41,
    "HOME EXPENSES|Lawn/Garden":42, "HOME EXPENSES|Home Supplies":43,
    "HOME EXPENSES|Maintenance":44, "HOME EXPENSES|Improvements":45,
    "HOME EXPENSES|Other":46,
    "DAILY LIVING|Groceries":50, "DAILY LIVING|Personal Supplies":51,
    "DAILY LIVING|Clothing":52, "DAILY LIVING|Cleaning Services":53,
    "DAILY LIVING|Dining/Eating Out":54, "DAILY LIVING|Dry Cleaning":55,
    "DAILY LIVING|Salon/Barber":56, "DAILY LIVING|FoodPanda":57,
    "DAILY LIVING|JazzCash/EasyPaisa":58, "DAILY LIVING|Other":59,
    "CHILDREN|Medical":63, "CHILDREN|Clothing":64, "CHILDREN|School Tuition":65,
    "CHILDREN|School Lunch":66, "CHILDREN|School Supplies":67,
    "CHILDREN|Babysitting":68, "CHILDREN|Toys/Games":69, "CHILDREN|Other":70,
    "TRANSPORTATION|Vehicle Payments":74, "TRANSPORTATION|Fuel":75,
    "TRANSPORTATION|Bus/Taxi/Train Fare":76, "TRANSPORTATION|Repairs":77,
    "TRANSPORTATION|Registration/License":78, "TRANSPORTATION|Other":79,
    "HEALTH|Doctor/Dentist":83, "HEALTH|Medicine/Drugs":84,
    "HEALTH|Lab Test":85, "HEALTH|Consultation":86, "HEALTH|Other":87,
    "EDUCATION|Tuition":91, "EDUCATION|Books":92,
    "EDUCATION|Music Lessons":93, "EDUCATION|Other":94,
    "CHARITY/GIFTS|Gifts Given":98, "CHARITY/GIFTS|Couple Charity":99,
    "CHARITY/GIFTS|Mother Charity":100, "CHARITY/GIFTS|Other":101,
    "OBLIGATIONS|Credit Card Debt":105, "OBLIGATIONS|Punjab ST on CC Fee @16":106,
    "OBLIGATIONS|Advance Tax 5%":107, "OBLIGATIONS|Other":108,
    "ENTERTAINMENT|Activities":119, "ENTERTAINMENT|Books":120,
    "ENTERTAINMENT|Games":121, "ENTERTAINMENT|Fun Stuff":122,
    "ENTERTAINMENT|Hobbies":123, "ENTERTAINMENT|Media":124,
    "ENTERTAINMENT|Outdoor Recreation":125, "ENTERTAINMENT|Sports":126,
    "ENTERTAINMENT|Toys/Gadgets":127, "ENTERTAINMENT|Vacation/Travel":128,
    "ENTERTAINMENT|Other":129,
    "SUBSCRIPTIONS|Netflix":140, "SUBSCRIPTIONS|Medium":141,
    "SUBSCRIPTIONS|Youtube":142, "SUBSCRIPTIONS|Google One":143,
    "SUBSCRIPTIONS|Hetzner VM":144, "SUBSCRIPTIONS|Claude Ai":145,
    "VACATION|Travel":149, "VACATION|Lodging":150, "VACATION|Food":151,
    "VACATION|Rental Car":152, "VACATION|Entertainment":153, "VACATION|Other":154,
    "MISCELLANEOUS|Bank Fees":158, "MISCELLANEOUS|Postage":159, "MISCELLANEOUS|Other":160,
};

const BUDGET_ROWS = { "Balance I Can Used (Bank)": 8, "Petty Cash": 11 };
const BUDGET_MONTH_COL = {};
MONTHS.forEach((m, i) => { BUDGET_MONTH_COL[m] = i + 2; });

// ── Helpers ───────────────────────────────────────────────────────────────────
function getDayCol(month, day) {
    const max = MONTH_DAYS[month];
    if (day < 1 || day > max) return null;
    return day + 1; // col 1=label, col 2=day1 ...
}

function getCellValue(cell) {
    if (!cell || cell.value === null || cell.value === undefined) return null;
    const v = cell.value;
    if (typeof v === 'object' && v !== null) {
        // Formula cell with cached result
        if ('result' in v) {
            const r = v.result;
            // Formula returns "" when empty (e.g. IF condition) — treat as null/0
            if (r === '' || r === '-' || r === ' - ') return null;
            return r;
        }
        // Formula cell with no cached result, or rich text object
        if ('formula' in v) return null;
        if ('richText' in v) return v.richText.map(r => r.text).join('');
        return null;
    }
    return v;
}

// ── Public API (all async — exceljs is promise-based) ────────────────────────
async function readMonthValue(month, section, category, day) {
    const row = ROW_MAP[`${section}|${category}`];
    if (!row) return { error: `No mapping for ${section} / ${category}` };
    const col = getDayCol(month, day);
    if (!col) return { error: `Day ${day} invalid for ${month}` };

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(getExcelPath());
    const ws = wb.getWorksheet(month);
    const cell = ws.getCell(row, col);
    return { value: getCellValue(cell) };
}

async function writeMonthValue(month, section, category, day, amount) {
    const row = ROW_MAP[`${section}|${category}`];
    if (!row) return { error: `No mapping for ${section} / ${category}` };
    const col = getDayCol(month, day);
    if (!col) return { error: `Day ${day} invalid for ${month} (max: ${MONTH_DAYS[month]})` };

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(getExcelPath());
    const ws = wb.getWorksheet(month);
    const cell = ws.getCell(row, col);

    // Preserve existing style, only change value
    cell.value = amount === 0 ? null : amount;

    await wb.xlsx.writeFile(getExcelPath());
    return { ok: true };
}

async function readBudgetValue(field, month) {
    if (!BUDGET_ROWS[field]) return { error: `Invalid budget field: ${field}` };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(getExcelPath());
    const ws = wb.getWorksheet('Budget');
    const cell = ws.getCell(BUDGET_ROWS[field], BUDGET_MONTH_COL[month]);
    return { value: getCellValue(cell) };
}

async function writeBudgetValue(field, month, amount) {
    if (!BUDGET_ROWS[field]) return { error: `Invalid budget field: ${field}` };
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(getExcelPath());
    const ws = wb.getWorksheet('Budget');
    const cell = ws.getCell(BUDGET_ROWS[field], BUDGET_MONTH_COL[month]);
    cell.value = amount === 0 ? null : amount;
    await wb.xlsx.writeFile(getExcelPath());
    return { ok: true };
}

async function getMonthSummary(month) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(getExcelPath());
    const ws = wb.getWorksheet(month);
    const numDays = MONTH_DAYS[month];

    let income = 0;
    let expenses = 0;

    for (const [key, row] of Object.entries(ROW_MAP)) {
        const section = key.split('|')[0];
        let rowSum = 0;
        for (let day = 1; day <= numDays; day++) {
            const col = day + 1;
            const val = getCellValue(ws.getCell(row, col));
            if (typeof val === 'number') rowSum += val;
        }
        if (section === 'INCOME') {
            income += rowSum;
        } else {
            expenses += rowSum;
        }
    }

    return { income, expenses };
}

// Returns { categoryName: total } for all categories in a section for a given month
async function getSectionTotals(month, section, categories) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(getExcelPath());
    const ws = wb.getWorksheet(month);
    const numDays = MONTH_DAYS[month];
    const result = {};

    for (const cat of categories) {
        const row = ROW_MAP[`${section}|${cat}`];
        if (!row) { result[cat] = 0; continue; }
        let total = 0;
        for (let day = 1; day <= numDays; day++) {
            const val = getCellValue(ws.getCell(row, day + 1));
            if (typeof val === 'number') total += val;
        }
        result[cat] = total;
    }
    return result;
}

// ── Core data loader (single workbook read per call) ─────────────────────────
async function loadMonthData(month, wb) {
    const budgetWs = wb.getWorksheet('Budget');
    const col = BUDGET_MONTH_COL[month];

    // Budget sheet reads
    const startingBalance    = getCellValue(budgetWs.getCell(3, 1))    || 0; // Row 3 Col 1: Year-start balance
    const pettyCashAvailable = getCellValue(budgetWs.getCell(11, col)) || 0; // Row 11: Petty Cash (set amount)
    // Row 14 has stale formula cache — computed fresh after pettyCashUsed below
    // NOTE: Rows 20 & 21 have stale formula cache after bot writes, so we compute fresh below

    const ws = wb.getWorksheet(month);
    if (!ws) return null;

    const numDays = MONTH_DAYS[month];
    const sectionData = {};

    for (const [key, row] of Object.entries(ROW_MAP)) {
        const [section, cat] = key.split('|');
        if (!sectionData[section]) sectionData[section] = {};
        let total = 0;
        for (let day = 1; day <= numDays; day++) {
            const val = getCellValue(ws.getCell(row, day + 1));
            if (typeof val === 'number') total += val;
        }
        sectionData[section][cat] = total;
    }

    const pettyCashUsed = Object.values(sectionData['Petty Cash Used'] || {}).reduce((a, b) => a + b, 0);
    const pettyCashLeft = pettyCashAvailable - pettyCashUsed; // computed fresh

    let totalIncome = 0, totalExpenses = 0;
    for (const [sec, cats] of Object.entries(sectionData)) {
        const secTotal = Object.values(cats).reduce((a, b) => a + b, 0);
        if (sec === 'INCOME') totalIncome += secTotal;
        else totalExpenses += secTotal;
    }

    const net = totalIncome - totalExpenses;

    return {
        startingBalance,
        pettyCashAvailable, pettyCashUsed, pettyCashLeft,
        totalIncome, totalExpenses, net,
        // balanceBank & balancePettyBank computed via computeRunningBalances()
        sectionData
    };
}

// ── Cumulative balance across months ─────────────────────────────────────────
// Jan:  balanceBank = startingBalance + Jan.net
// Feb:  balanceBank = Jan.balanceBank + Feb.net  (carries forward)
// balancePettyBank  = balanceBank + pettyCashLeft  (per month)
function computeRunningBalances(allData, startingBalance) {
    let runningBank = startingBalance;
    for (const month of MONTHS) {
        const d = allData[month];
        if (!d) continue;
        runningBank        = runningBank + d.net;
        d.balanceBank      = runningBank;
        d.balancePettyBank = runningBank + d.pettyCashLeft;
    }
}

// ── Shared HTML pieces ────────────────────────────────────────────────────────
const N = n => (n || 0).toLocaleString('en-PK');
const sign = n => n >= 0 ? '+' : '';
const col = n => n >= 0 ? '#16a34a' : '#dc2626';

function summaryCardsHtml(d) {
    const row = (label, value, color) =>
        `<div class="sum-row">
            <span class="sum-label">${label}</span>
            <span class="sum-value" style="color:${color}">${value}</span>
         </div>`;

    const boxes = [
        {
            title: '💵 Petty Cash',
            color: '#2563eb',
            rows: [
                row('Available', N(d.pettyCashAvailable), '#2563eb'),
                row('Used',      N(d.pettyCashUsed),      '#dc2626'),
                row('Left',      N(d.pettyCashLeft),      col(d.pettyCashLeft)),
            ]
        },
        {
            title: '🏦 Bank',
            color: '#16a34a',
            rows: [
                row('Total Income',   N(d.totalIncome),              '#16a34a'),
                row('Total Expenses', N(d.totalExpenses),            '#dc2626'),
                row('Net',            sign(d.net) + N(d.net),        col(d.net)),
            ]
        },
        {
            title: '⚖️ Balance',
            color: '#1e3a5f',
            rows: [
                row('Bank',        N(d.balanceBank),      '#1e3a5f'),
                row('Petty + Bank',N(d.balancePettyBank), col(d.balancePettyBank)),
            ]
        },
    ];

    return `<div class="summary-boxes">${boxes.map(b => `
        <div class="sum-box">
            <div class="sum-box-title" style="border-color:${b.color};color:${b.color}">${b.title}</div>
            ${b.rows.join('')}
        </div>`).join('')}
    </div>`;
}

function sectionTabsHtml(sectionData, prefix = '') {
    const sections = Object.keys(sectionData);
    const activeSections = sections.filter(s => Object.values(sectionData[s]).some(v => v > 0));
    if (activeSections.length === 0) return '<p class="empty">No data for this period.</p>';

    const safeid = s => prefix + s.replace(/[^a-zA-Z0-9]/g, '_');

    const tabBtns = activeSections.map((s, i) =>
        `<button class="tab-btn${i === 0 ? ' active' : ''}" onclick="showTab('${safeid(s)}',this)">${s}</button>`
    ).join('');

    const tabPanels = activeSections.map((s, i) => {
        const cats = sectionData[s];
        const rows = Object.entries(cats)
            .filter(([, v]) => v > 0)
            .map(([cat, v]) => `<tr><td>${cat}</td><td class="num">${N(v)}</td></tr>`)
            .join('');
        const total = Object.values(cats).reduce((a, b) => a + b, 0);
        return `<div id="${safeid(s)}" class="tab-panel${i === 0 ? ' active' : ''}">
            <table><tbody>${rows || '<tr><td colspan="2" class="empty-row">No entries</td></tr>'}</tbody>
            <tfoot><tr><td><strong>Total</strong></td><td class="num"><strong>${N(total)}</strong></td></tr></tfoot>
            </table></div>`;
    }).join('');

    return `<div class="tab-bar">${tabBtns}</div><div class="tab-panels">${tabPanels}</div>`;
}

const COMMON_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f1f5f9; color: #1e293b; }
.header { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; padding: 20px 16px; text-align: center; }
.header h1 { font-size: 20px; font-weight: 700; }
.header p { font-size: 12px; opacity: .75; margin-top: 3px; }
.summary-boxes { display: flex; flex-direction: column; gap: 10px; padding: 14px; }
.sum-box { background: white; border-radius: 10px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.sum-box-title { font-size: 13px; font-weight: 700; border-left: 3px solid; padding-left: 8px; margin-bottom: 10px; }
.sum-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; border-bottom: 1px solid #f1f5f9; }
.sum-row:last-child { border-bottom: none; }
.sum-label { font-size: 12px; color: #64748b; }
.sum-value { font-size: 14px; font-weight: 700; }
.section-wrap { padding: 0 14px 28px; }
.section-title { font-size: 13px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px; }
.tab-bar { display: flex; overflow-x: auto; gap: 6px; padding: 0 0 8px; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
.tab-bar::-webkit-scrollbar { display: none; }
.tab-btn { flex-shrink: 0; padding: 7px 12px; border-radius: 20px; border: 1.5px solid #cbd5e1; background: white; color: #475569; font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap; }
.tab-btn.active { background: #1e3a5f; border-color: #1e3a5f; color: white; }
.tab-panel { display: none; }
.tab-panel.active { display: block; }
table { width: 100%; border-collapse: collapse; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
td { padding: 9px 13px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
td.num { text-align: right; font-weight: 600; }
tfoot td { background: #f8fafc; border-top: 2px solid #e2e8f0; }
tr:last-child td { border-bottom: none; }
.empty { text-align: center; color: #94a3b8; font-size: 13px; padding: 20px; }
.empty-row { text-align: center; color: #94a3b8; }
.footer { text-align: center; font-size: 11px; color: #94a3b8; padding: 16px; }
`;

const TAB_JS = `
function showTab(id, btn) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const panel = document.getElementById(id);
    if (panel) panel.classList.add('active');
    if (btn) btn.classList.add('active');
}
`;

// ── Month HTML ────────────────────────────────────────────────────────────────
async function generateMonthHtml(month) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(getExcelPath());

    // Load all months up to target to compute correct cumulative running balance
    const allData = {};
    let startingBalance = 0;
    for (const m of MONTHS) {
        const d = await loadMonthData(m, wb);
        if (d) { startingBalance = d.startingBalance; allData[m] = d; }
        if (m === month) break;
    }
    computeRunningBalances(allData, startingBalance);

    const d = allData[month];
    if (!d) return '<html><body>No data found for ' + month + '</body></html>';

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${month} 2026 — SavingHomeLab</title>
<style>${COMMON_CSS}</style></head><body>
<div class="header"><h1>💰 ${month} 2026 Report</h1>
<p>SavingHomeLab · ${new Date().toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'})}</p></div>
${summaryCardsHtml(d)}
<div class="section-wrap">
<div class="section-title">Sections — tap to view</div>
${sectionTabsHtml(d.sectionData)}
</div>
<div class="footer">SavingHomeLab Bot · ${month} 2026</div>
<script>${TAB_JS}</script></body></html>`;
}

// ── Year HTML ─────────────────────────────────────────────────────────────────
async function generateYearHtml() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(getExcelPath());

    // Load all months and compute cumulative running balances
    const allData = {};
    let startingBalance = 0;
    for (const month of MONTHS) {
        const d = await loadMonthData(month, wb);
        if (d) { startingBalance = d.startingBalance; allData[month] = d; }
    }
    computeRunningBalances(allData, startingBalance);

    // Year totals — sum income/expense; balance comes from last active month
    let yrIncome = 0, yrExpenses = 0, yrPCAvail = 0, yrPCUsed = 0, yrPCLeft = 0;
    let lastActiveMonth = null;
    MONTHS.forEach(m => {
        if (!allData[m]) return;
        yrIncome   += allData[m].totalIncome;
        yrExpenses += allData[m].totalExpenses;
        yrPCAvail  += allData[m].pettyCashAvailable;
        yrPCUsed   += allData[m].pettyCashUsed;
        if (allData[m].totalIncome > 0 || allData[m].totalExpenses > 0) lastActiveMonth = m;
    });
    const yrNet    = yrIncome - yrExpenses;
    const lastData = lastActiveMonth ? allData[lastActiveMonth] : { balanceBank: startingBalance, balancePettyBank: startingBalance, pettyCashLeft: 0 };
    yrPCLeft = lastData.pettyCashLeft;

    // Month tab buttons
    const monthBtns = MONTHS.map((m, i) =>
        `<button class="tab-btn${i===0?' active':''}" onclick="showMonth('${m}',this)">${m}</button>`
    ).join('');

    // Month tab panels
    const monthPanels = MONTHS.map((m, i) => {
        const d = allData[m];
        if (!d) return `<div id="month_${m}" class="month-panel${i===0?' active':''}"><p class="empty">No data</p></div>`;

        const sectionRows = Object.entries(d.sectionData).map(([sec, cats]) => {
            const total = Object.values(cats).reduce((a, b) => a + b, 0);
            if (total === 0) return '';
            const isInc = sec === 'INCOME';
            return `<tr><td>${sec}</td><td class="num" style="color:${isInc?'#16a34a':'#334155'}">${N(total)}</td></tr>`;
        }).join('');

        return `<div id="month_${m}" class="month-panel${i===0?' active':''}">
        ${summaryCardsHtml(d)}
        <div class="section-wrap">
        <div class="section-title">Section Breakdown</div>
        <table><thead><tr><th>Section</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>${sectionRows}</tbody>
        <tfoot><tr><td><strong>Net</strong></td><td class="num" style="color:${col(d.net)}"><strong>${sign(d.net)}${N(d.net)}</strong></td></tr></tfoot>
        </table>
        <br>
        <div class="section-title">Category Detail</div>
        ${sectionTabsHtml(d.sectionData, m + '_')}
        </div>
        <div style="height:16px"></div></div>`;
    }).join('');

    const yrSummary = summaryCardsHtml({
        pettyCashAvailable: yrPCAvail, pettyCashUsed: yrPCUsed, pettyCashLeft: yrPCLeft,
        totalIncome: yrIncome, totalExpenses: yrExpenses, net: yrNet,
        balanceBank:      lastData.balanceBank,
        balancePettyBank: lastData.balancePettyBank,
    });

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>2026 Year Overview — SavingHomeLab</title>
<style>
${COMMON_CSS}
.month-panel { display: none; }
.month-panel.active { display: block; }
.year-summary { background: white; margin: 14px; border-radius: 10px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.year-summary h3 { font-size: 13px; color: #475569; margin-bottom: 10px; text-transform: uppercase; letter-spacing: .4px; }
.month-tab-bar { display: flex; overflow-x: auto; gap: 6px; padding: 14px 14px 6px; -webkit-overflow-scrolling: touch; scrollbar-width: none; background: white; border-bottom: 1px solid #e2e8f0; }
.month-tab-bar::-webkit-scrollbar { display: none; }
th { background: #1e3a5f; color: white; padding: 9px 13px; font-size: 12px; text-align: left; }
</style></head><body>
<div class="header"><h1>📊 2026 Year Overview</h1>
<p>SavingHomeLab · ${new Date().toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'})}</p></div>
<div class="year-summary">
<h3>2026 Year Totals</h3>
${yrSummary}
</div>
<div class="month-tab-bar">${monthBtns}</div>
${monthPanels}
<div class="footer">SavingHomeLab Bot · 2026</div>
<script>
${TAB_JS}
function showMonth(m, btn) {
    document.querySelectorAll('.month-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.month-tab-bar .tab-btn').forEach(b => b.classList.remove('active'));
    const panel = document.getElementById('month_' + m);
    if (panel) panel.classList.add('active');
    if (btn) btn.classList.add('active');
}
</script></body></html>`;
}


// ── WhatsApp summary data (with running balances) ────────────────────────────
async function getMonthReport(month) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(getExcelPath());
    const allData = {};
    let startingBalance = 0;
    for (const m of MONTHS) {
        const d = await loadMonthData(m, wb);
        if (d) { startingBalance = d.startingBalance; allData[m] = d; }
        if (m === month) break;
    }
    computeRunningBalances(allData, startingBalance);
    return allData[month] || null;
}

async function getYearReport() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(getExcelPath());
    const allData = {};
    let startingBalance = 0;
    for (const m of MONTHS) {
        const d = await loadMonthData(m, wb);
        if (d) { startingBalance = d.startingBalance; allData[m] = d; }
    }
    computeRunningBalances(allData, startingBalance);

    let totalIncome = 0, totalExpenses = 0, totalPCAvail = 0, totalPCUsed = 0;
    let lastData = { balanceBank: startingBalance, balancePettyBank: startingBalance, pettyCashLeft: 0 };
    const monthly = {};
    for (const m of MONTHS) {
        const d = allData[m];
        if (!d) continue;
        totalIncome    += d.totalIncome;
        totalExpenses  += d.totalExpenses;
        totalPCAvail   += d.pettyCashAvailable;
        totalPCUsed    += d.pettyCashUsed;
        if (d.totalIncome > 0 || d.totalExpenses > 0) lastData = d;
        monthly[m] = { income: d.totalIncome, expenses: d.totalExpenses, net: d.net };
    }
    return {
        totalIncome, totalExpenses,
        net: totalIncome - totalExpenses,
        pettyCashAvailable: totalPCAvail,
        pettyCashUsed: totalPCUsed,
        pettyCashLeft: lastData.pettyCashLeft,
        balanceBank: lastData.balanceBank,
        balancePettyBank: lastData.balancePettyBank,
        monthly
    };
}


// ── Year Template Creator ─────────────────────────────────────────────────────
async function createYearTemplate(year, templatePath) {
    const { YEAR_FOLDER } = require('./config');
    const folder = YEAR_FOLDER;
    const outputPath = require('path').join(folder, `Saving-${year}.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(templatePath);

    // 1. Section-Category: update year cell (D1) and all date cells
    const sc = wb.getWorksheet('Section-Category');
    if (sc) {
        // D1 = year integer
        sc.getCell('D1').value = year;

        // Date cells are in rows 6-17 (Jan-Dec), cols 4-35 (D-AH)
        for (let row = 6; row <= 17; row++) {
            sc.getRow(row).eachCell({ includeEmpty: false }, (cell) => {
                if (cell.value instanceof Date) {
                    const d = new Date(cell.value);
                    d.setFullYear(year);
                    cell.value = d;
                }
            });
        }
    }

    // 2. Budget sheet: replace title
    const budget = wb.getWorksheet('Budget');
    if (budget) {
        const titleCell = budget.getCell('A1');
        if (titleCell.value && typeof titleCell.value === 'string') {
            titleCell.value = 'Budget Manager v0.1';
        }
    }

    await wb.xlsx.writeFile(outputPath);
    return { ok: true, path: outputPath, year };
}

module.exports = {
    MONTHS, MONTH_DAYS, BUDGET_ROWS,
    readMonthValue, writeMonthValue,
    readBudgetValue, writeBudgetValue,
    getMonthSummary, getSectionTotals,
    generateMonthHtml, generateYearHtml,
    getMonthReport, getYearReport,
    createYearTemplate
};