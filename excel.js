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

    const pettyCashDailyRows = []; // [{day, cat, amount}]

    // dailyData[section][cat] = { day: amount, ... }
    const dailyData = {};

    for (const [key, row] of Object.entries(ROW_MAP)) {
        const [section, cat] = key.split('|');
        if (!sectionData[section]) sectionData[section] = {};
        if (!dailyData[section]) dailyData[section] = {};
        if (!dailyData[section][cat]) dailyData[section][cat] = {};
        let total = 0;
        for (let day = 1; day <= numDays; day++) {
            const val = getCellValue(ws.getCell(row, day + 1));
            if (typeof val === 'number' && val !== 0) {
                total += val;
                dailyData[section][cat][day] = val;
                if (section === 'Petty Cash Used') {
                    pettyCashDailyRows.push({ day, cat, amount: val });
                }
            }
        }
        sectionData[section][cat] = total;
    }

    const pettyCashUsed = Object.values(sectionData['Petty Cash Used'] || {}).reduce((a, b) => a + b, 0);
    const pettyCashLeft = pettyCashAvailable - pettyCashUsed; // computed fresh

    // totalPerDay: sum of ALL section values per day (mirrors Excel row 164)
    const totalPerDay = {};
    for (const section of Object.keys(dailyData)) {
        for (const cat of Object.keys(dailyData[section])) {
            for (const [dayStr, val] of Object.entries(dailyData[section][cat])) {
                const d = Number(dayStr);
                totalPerDay[d] = (totalPerDay[d] || 0) + val;
            }
        }
    }

    let totalIncome = 0, totalExpenses = 0;
    for (const [sec, cats] of Object.entries(sectionData)) {
        const secTotal = Object.values(cats).reduce((a, b) => a + b, 0);
        if (sec === 'INCOME') {
            totalIncome += secTotal;
        } else if (sec === 'Petty Cash Used') {
            // Excluded from bank expenses — shown separately in Petty Cash section
        } else {
            totalExpenses += secTotal;
        }
    }
    // totalExpenses = bank expenses only (Petty Cash Used shown separately)
    const net = totalIncome - totalExpenses;

    return {
        startingBalance,
        pettyCashAvailable, pettyCashUsed, pettyCashLeft,
        totalIncome, totalExpenses, net,
        // balanceBank & balancePettyBank computed via computeRunningBalances()
        sectionData,
        pettyCashDailyRows,
        dailyData,
        totalPerDay
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
                ...(d.startingBalance !== undefined ? [row('Initial Balance', N(d.startingBalance), '#64748b')] : []),
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

function sectionTabsHtml(sectionData, prefix = '', pettyCashInfo = null) {
    const sections = Object.keys(sectionData);
    // Exclude Petty Cash Used from normal tabs — we handle it separately with daily breakdown
    const activeSections = sections.filter(s =>
        s !== 'Petty Cash Used' && Object.values(sectionData[s]).some(v => v > 0)
    );

    // Build Petty Cash Used as first tab if it has data
    const pcUsed = sectionData['Petty Cash Used'] || {};
    const pcTotal = Object.values(pcUsed).reduce((a, b) => a + b, 0);
    const hasPetty = pcTotal > 0;

    const allTabs = hasPetty ? ['Petty Cash Used', ...activeSections] : activeSections;
    if (allTabs.length === 0) return '<p class="empty">No data for this period.</p>';

    const safeid = s => prefix + s.replace(/[^a-zA-Z0-9]/g, '_');

    const tabBtns = allTabs.map((s, i) =>
        `<button class="tab-btn${i === 0 ? ' active' : ''}" onclick="showTab('${safeid(s)}',this)">${s === 'Petty Cash Used' ? '💵 Petty Cash' : s}</button>`
    ).join('');

    const tabPanels = allTabs.map((s, i) => {
        // Special Petty Cash Used tab with daily breakdown
        if (s === 'Petty Cash Used') {
            const inner = pettyCashInfo
                ? pettyCashTabHtml(pettyCashInfo.month, pettyCashInfo.dailyRows, pcTotal)
                : (() => {
                    const rows = Object.entries(pcUsed).filter(([,v])=>v>0)
                        .map(([cat,v])=>`<tr><td>${cat}</td><td class="num">${N(v)}</td></tr>`).join('');
                    return `<table><tbody>${rows}</tbody>
                        <tfoot><tr><td><strong>Total</strong></td><td class="num"><strong>${N(pcTotal)}</strong></td></tr></tfoot></table>`;
                })();
            return `<div id="${safeid(s)}" class="tab-panel${i === 0 ? ' active' : ''}">${inner}</div>`;
        }

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

// ── Petty Cash Used detailed tab ──────────────────────────────────────────────
function pettyCashTabHtml(month, pettyCashDailyRows, total) {
    if (!pettyCashDailyRows || pettyCashDailyRows.length === 0) {
        return '<p class="empty">No petty cash entries.</p>';
    }
    // Aggregate by category (no date shown in Sections tab)
    const bycat = {};
    pettyCashDailyRows.forEach(r => { bycat[r.cat] = (bycat[r.cat] || 0) + r.amount; });
    const rows = Object.entries(bycat)
        .filter(([,v]) => v > 0)
        .map(([cat, v]) => `<tr><td>${cat}</td><td class="num">${N(v)}</td></tr>`)
        .join('');
    return `
    <table>
        <thead><tr>
            <th style="text-align:left;background:#7c3aed;color:white;padding:9px 13px;font-size:12px;">Category</th>
            <th style="text-align:right;background:#7c3aed;color:white;padding:9px 13px;font-size:12px;">Amount</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
            <td><strong>Total</strong></td>
            <td class="num"><strong>${N(total)}</strong></td>
        </tr></tfoot>
    </table>`;
}



// ── Total Per Day summary table (mirrors Excel row 164) ──────────────────────
function totalPerDayHtml(month, totalPerDay) {
    const days = Object.keys(totalPerDay).map(Number).sort((a, b) => a - b);
    if (days.length === 0) return '';
    const monthIdx = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(month) + 1;
    const monStr = String(monthIdx).padStart(2,'0');
    const grandTotal = days.reduce((s, d) => s + (totalPerDay[d] || 0), 0);

    const headerCols = days.map(d => {
        const ds = String(d).padStart(2,'0');
        return `<th>${ds}/${monStr}</th>`;
    }).join('');

    const valueCols = days.map(d =>
        `<td class="num tpd-val">${N(totalPerDay[d] || 0)}</td>`
    ).join('');

    return `
    <div class="breakdown-section">
        <div class="breakdown-title" style="background:#0f766e">📅 Total Per Day</div>
        <div class="table-scroll">
        <table class="breakdown-table">
            <thead><tr>
                <th class="cat-col">Date</th>
                ${headerCols}
                <th class="total-col">Grand Total</th>
            </tr></thead>
            <tbody><tr>
                <td class="cat-name"><strong>Total</strong></td>
                ${valueCols}
                <td class="num total-cell"><strong>${N(grandTotal)}</strong></td>
            </tr></tbody>
        </table>
        </div>
    </div>`;
}

// ── Section Breakdown: date-columns × category-rows ──────────────────────────
function sectionBreakdownHtml(month, dailyData, numDays) {
    const monthIdx = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(month) + 1;
    const monStr = String(monthIdx).padStart(2,'0');

    // Build one table per section
    const SECTION_NAMES = Object.keys(dailyData);
    let html = '';

    for (const section of SECTION_NAMES) {
        const cats = dailyData[section];

        // Only show categories that have at least one entry
        const activeCats = Object.keys(cats).filter(cat =>
            Object.values(cats[cat]).some(v => v > 0)
        );
        if (activeCats.length === 0) continue;

        // Only show days that have at least one value IN THIS SECTION
        const sectionDays = new Set();
        activeCats.forEach(cat => {
            Object.keys(cats[cat]).forEach(d => sectionDays.add(Number(d)));
        });
        const days = [...sectionDays].sort((a, b) => a - b);
        if (days.length === 0) continue;

        // Header row: Category | date1 | date2 | ... | Total
        const headerCols = days.map(d => {
            const ds = String(d).padStart(2,'0');
            return `<th>${ds}/${monStr}</th>`;
        }).join('');

        // Category rows — only cells with values shown, zeros skipped
        const bodyRows = activeCats.map(cat => {
            let rowTotal = 0;
            const cells = days.map(d => {
                const v = cats[cat][d] || 0;
                rowTotal += v;
                return v ? `<td class="num">${N(v)}</td>` : `<td class="num empty-cell"></td>`;
            }).join('');
            return `<tr><td class="cat-name">${cat}</td>${cells}<td class="num total-cell">${N(rowTotal)}</td></tr>`;
        }).join('');

        // Section total row — only non-zero day totals shown
        const secTotals = days.map(d => {
            const t = activeCats.reduce((sum, cat) => sum + (cats[cat][d] || 0), 0);
            return t ? `<td class="num sec-total">${N(t)}</td>` : `<td class="num sec-total"></td>`;
        }).join('');
        const grandTotal = activeCats.reduce((sum, cat) =>
            sum + Object.values(cats[cat]).reduce((a,b) => a+b, 0), 0);

        const isIncome = section === 'INCOME';
        const headerBg = isIncome ? '#166534' : section === 'Petty Cash Used' ? '#7c3aed' : '#1e3a5f';

        html += `
        <div class="breakdown-section">
            <div class="breakdown-title" style="background:${headerBg}">${section}</div>
            <div class="table-scroll">
            <table class="breakdown-table">
                <thead><tr>
                    <th class="cat-col">Category</th>
                    ${headerCols}
                    <th class="total-col">Total</th>
                </tr></thead>
                <tbody>${bodyRows}</tbody>
                <tfoot><tr>
                    <td class="cat-name"><strong>Total</strong></td>
                    ${secTotals}
                    <td class="num total-cell"><strong>${N(grandTotal)}</strong></td>
                </tr></tfoot>
            </table>
            </div>
        </div>`;
    }
    return html || '<p class="empty">No data.</p>';
}


// ── Visual Analysis: pie charts for sections and category breakdowns ──────────
const PIE_COLORS = [
    '#2563eb','#16a34a','#dc2626','#9333ea','#ea580c','#0891b2',
    '#ca8a04','#db2777','#65a30d','#7c3aed','#0f766e','#c2410c',
    '#1d4ed8','#15803d','#b91c1c','#6d28d9'
];

function buildPieSvg(slices, idPrefix) {
    // slices = [{label, value, pct, color}]
    const cx = 110, cy = 110, r = 90;
    let paths = '';
    let angle = -Math.PI / 2; // start from top

    slices.forEach((s, i) => {
        const sweep = s.pct / 100 * 2 * Math.PI;
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        angle += sweep;
        const x2 = cx + r * Math.cos(angle);
        const y2 = cy + r * Math.sin(angle);
        const large = sweep > Math.PI ? 1 : 0;

        // Midpoint for percentage label
        const midAngle = angle - sweep / 2;
        const lx = cx + (r * 0.65) * Math.cos(midAngle);
        const ly = cy + (r * 0.65) * Math.sin(midAngle);
        const pctLabel = s.pct >= 4 ? s.pct.toFixed(1) + '%' : '';

        paths += `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z"
            fill="${s.color}" stroke="white" stroke-width="1.5"/>`;
        if (pctLabel) {
            paths += `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" text-anchor="middle" dominant-baseline="middle"
                fill="white" font-size="10" font-weight="700">${pctLabel}</text>`;
        }
    });

    // Legend below pie
    const legendItems = slices.map((s, i) => {
        const row = Math.floor(i / 2);
        const colx = (i % 2) * 110 + 10;
        const coly = 230 + row * 22;
        return `<rect x="${colx}" y="${coly}" width="12" height="12" fill="${s.color}" rx="2"/>
<text x="${colx + 16}" y="${coly + 10}" font-size="10" fill="#334155">${s.label.length > 12 ? s.label.slice(0,11)+'…' : s.label}</text>`;
    }).join('');

    const legendRows = Math.ceil(slices.length / 2);
    const svgH = 230 + legendRows * 22 + 8;

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 ${svgH}" style="width:100%;max-width:280px;display:block;margin:0 auto">
${paths}${legendItems}
</svg>`;
}

function sectionsPieHtml(sectionData, titlePrefix) {
    // Expense sections only (exclude INCOME for expense pie, show INCOME separately)
    const expenseSlices = [], incomeSlices = [];
    let totalExp = 0, totalInc = 0;

    Object.entries(sectionData).forEach(([sec, cats]) => {
        const total = Object.values(cats).reduce((a,b) => a+b, 0);
        if (total === 0) return;
        if (sec === 'INCOME') { totalInc += total; incomeSlices.push({ label: sec, value: total }); }
        else { totalExp += total; expenseSlices.push({ label: sec, value: total }); }
    });

    const buildPct = (items, total) => items
        .map((s, i) => ({ ...s, pct: total > 0 ? (s.value / total * 100) : 0, color: PIE_COLORS[i % PIE_COLORS.length] }))
        .sort((a, b) => b.value - a.value);

    let html = '<div class="viz-wrap">';
    html += '<div class="viz-title">📊 Visual Analysis</div>';

    if (expenseSlices.length > 0) {
        const slices = buildPct(expenseSlices, totalExp);
        html += `<div class="viz-card">
            <div class="viz-subtitle">💸 Expense Breakdown by Section</div>
            ${buildPieSvg(slices, titlePrefix + '_exp')}
        </div>`;
    }
    if (incomeSlices.length > 0) {
        const slices = buildPct(incomeSlices, totalInc);
        html += `<div class="viz-card">
            <div class="viz-subtitle">💵 Income Breakdown by Section</div>
            ${buildPieSvg(slices, titlePrefix + '_inc')}
        </div>`;
    }
    html += '</div>';
    return html;
}

function breakdownPieHtml(sectionData, titlePrefix) {
    // One pie per section showing category breakdown
    let html = '<div class="viz-wrap"><div class="viz-title">📊 Visual Analysis — Category Breakdown</div>';
    let hasAny = false;

    Object.entries(sectionData).forEach(([sec, cats], si) => {
        const items = Object.entries(cats).filter(([,v]) => v > 0);
        if (items.length === 0) return;
        const total = items.reduce((s,[,v]) => s+v, 0);
        if (total === 0) return;
        hasAny = true;
        const slices = items
            .sort((a,b) => b[1]-a[1])
            .map(([cat, val], i) => ({
                label: cat, value: val,
                pct: val / total * 100,
                color: PIE_COLORS[i % PIE_COLORS.length]
            }));
        html += `<div class="viz-card">
            <div class="viz-subtitle">${sec}</div>
            ${buildPieSvg(slices, titlePrefix + '_' + si)}
        </div>`;
    });

    html += '</div>';
    return hasAny ? html : '';
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
.viz-wrap { padding: 0 14px 8px; }
.viz-title { font-size: 13px; font-weight: 700; color: #1e3a5f; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 10px; padding-top: 6px; }
.viz-subtitle { font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px; }
.viz-card { background: white; border-radius: 10px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 12px; }
.breakdown-section { margin-bottom: 18px; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.breakdown-title { color: white; padding: 9px 14px; font-size: 12px; font-weight: 700; }
.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.breakdown-table { width: max-content; min-width: 100%; border-radius: 0; box-shadow: none; }
.breakdown-table th { background: #f1f5f9; color: #475569; padding: 8px 10px; font-size: 11px; text-align: right; white-space: nowrap; border-bottom: 2px solid #e2e8f0; }
.breakdown-table th.cat-col { text-align: left; min-width: 130px; position: sticky; left: 0; background: #f1f5f9; z-index: 1; }
.breakdown-table th.total-col { background: #e2e8f0; }
.cat-name { font-size: 12px; min-width: 130px; position: sticky; left: 0; background: white; z-index: 1; }
.empty-cell { color: #94a3b8; font-weight: 400; }
.total-cell { background: #f8fafc; font-weight: 700; }
.sec-total { font-weight: 600; color: #334155; }
.tpd-val { font-weight: 600; color: #0f766e; }
.main-tabs { display: flex; gap: 8px; padding: 14px 14px 0; border-bottom: 2px solid #e2e8f0; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; background: white; margin-bottom: 14px; }
.main-tabs::-webkit-scrollbar { display: none; }
.main-tab-btn { flex-shrink: 0; padding: 9px 16px; font-size: 13px; font-weight: 600; border: none; background: transparent; color: #64748b; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -2px; }
.main-tab-btn.active { color: #1e3a5f; border-bottom-color: #1e3a5f; }
.main-tab-panel { display: none; }
.main-tab-panel.active { display: block; }
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

    const activeYear = require('./config').getActiveYear() || new Date().getFullYear();
    const numDays = MONTH_DAYS[month];
    const mainTabJs = `
function showMainTab(id, btn) {
    document.querySelectorAll('.main-tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.main-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    btn.classList.add('active');
}`;

    return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${month} ${activeYear} Report</title>
<style>${COMMON_CSS}</style></head><body>
<div class="header"><h1>💰 ${month} ${activeYear} Report</h1>
<p>Gofy · ${new Date().toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'})}</p></div>
${summaryCardsHtml(d)}
<div class="main-tabs">
  <button class="main-tab-btn active" onclick="showMainTab('mt_sections',this)">📂 Sections</button>
  <button class="main-tab-btn" onclick="showMainTab('mt_breakdown',this)">📊 Section Breakdown</button>
</div>
<div id="mt_sections" class="main-tab-panel active">
  <div class="section-wrap">
    ${sectionTabsHtml(d.sectionData, '', { month, dailyRows: d.pettyCashDailyRows || [] })}
  </div>
  ${sectionsPieHtml(d.sectionData, month)}
</div>
<div id="mt_breakdown" class="main-tab-panel">
  <div class="section-wrap">
    ${totalPerDayHtml(month, d.totalPerDay || {})}
    ${sectionBreakdownHtml(month, d.dailyData || {}, numDays)}
  </div>
  ${breakdownPieHtml(d.sectionData, month)}
</div>
<div class="footer">Gofy Bot · ${month} ${activeYear}</div>
<script>${TAB_JS}${mainTabJs}</script></body></html>`;
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

        const numDaysM = MONTH_DAYS[m];
        const mainTabJsM = `
function showMainTab_${m}(id, btn) {
    document.querySelectorAll('#month_${m} .main-tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('#month_${m} .main-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    btn.classList.add('active');
}`;
        return `<div id="month_${m}" class="month-panel${i===0?' active':''}">
        ${summaryCardsHtml(d)}
        <div class="main-tabs">
          <button class="main-tab-btn active" onclick="showMainTab_${m}('mt_${m}_sections',this)">📂 Sections</button>
          <button class="main-tab-btn" onclick="showMainTab_${m}('mt_${m}_breakdown',this)">📊 Section Breakdown</button>
        </div>
        <div id="mt_${m}_sections" class="main-tab-panel active">
          <div class="section-wrap">
            ${sectionTabsHtml(d.sectionData, m + '_', { month: m, dailyRows: d.pettyCashDailyRows || [] })}
          </div>
          ${sectionsPieHtml(d.sectionData, m)}
        </div>
        <div id="mt_${m}_breakdown" class="main-tab-panel">
          <div class="section-wrap">
            ${totalPerDayHtml(m, d.totalPerDay || {})}
            ${sectionBreakdownHtml(m, d.dailyData || {}, numDaysM)}
          </div>
          ${breakdownPieHtml(d.sectionData, m)}
        </div>
        <div style="height:16px"></div>
        <script>${mainTabJsM}</script>
        </div>`;
    }).join('');

    const yrSummary = summaryCardsHtml({
        pettyCashAvailable: yrPCAvail, pettyCashUsed: yrPCUsed, pettyCashLeft: yrPCLeft,
        totalIncome: yrIncome, totalExpenses: yrExpenses, net: yrNet,
        balanceBank:      lastData.balanceBank,
        balancePettyBank: lastData.balancePettyBank,
        startingBalance,
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
    // Carry forward pettyCashAvailable — Budget row 11 may only be set for some months
    let carryPCAvail = 0;
    for (const m of MONTHS) {
        const d = allData[m];
        if (!d) continue;
        if (d.pettyCashAvailable > 0) carryPCAvail = d.pettyCashAvailable;
        const pcAvail = carryPCAvail;
        const pcLeft  = pcAvail - d.pettyCashUsed;
        totalIncome    += d.totalIncome;
        totalExpenses  += d.totalExpenses;
        totalPCAvail   += d.pettyCashAvailable > 0 ? d.pettyCashAvailable : 0;
        totalPCUsed    += d.pettyCashUsed;
        if (d.totalIncome > 0 || d.totalExpenses > 0) lastData = d;
        monthly[m] = { income: d.totalIncome, expenses: d.totalExpenses, net: d.net,
                       pettyCashAvailable: pcAvail, pettyCashUsed: d.pettyCashUsed, pettyCashLeft: pcLeft };
    }
    return {
        totalIncome, totalExpenses,
        net: totalIncome - totalExpenses,
        pettyCashAvailable: totalPCAvail,
        pettyCashUsed: totalPCUsed,
        pettyCashLeft: lastData.pettyCashLeft,
        balanceBank: lastData.balanceBank,
        balancePettyBank: lastData.balancePettyBank,
        startingBalance,
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


// ── Read all filled days for a single category ────────────────────────────────
async function getCategoryDayValues(month, section, category) {
    const row = ROW_MAP[`${section}|${category}`];
    if (!row) return {};
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(getExcelPath());
    const ws = wb.getWorksheet(month);
    if (!ws) return {};
    const numDays = MONTH_DAYS[month];
    const filled = {};
    for (let day = 1; day <= numDays; day++) {
        const val = getCellValue(ws.getCell(row, day + 1));
        if (typeof val === 'number' && val !== 0) filled[day] = val;
    }
    return filled;
}


// ── Starting Balance (Budget sheet Row 3, Col 1) ──────────────────────────────
async function readStartingBalance() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(getExcelPath());
    const ws = wb.getWorksheet('Budget');
    const cell = ws.getCell(3, 1);
    return { value: getCellValue(cell) || 0 };
}

async function writeStartingBalance(amount) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(getExcelPath());
    const ws = wb.getWorksheet('Budget');
    const cell = ws.getCell(3, 1);
    cell.value = amount === 0 ? null : amount;
    await wb.xlsx.writeFile(getExcelPath());
    return { ok: true };
}

module.exports = {
    MONTHS, MONTH_DAYS, BUDGET_ROWS,
    readMonthValue, writeMonthValue,
    readBudgetValue, writeBudgetValue,
    getMonthSummary, getSectionTotals,
    generateMonthHtml, generateYearHtml,
    getMonthReport, getYearReport,
    getCategoryDayValues,
    readStartingBalance,
    writeStartingBalance,
    createYearTemplate
};