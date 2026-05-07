'use strict';

const path = require('path');
const fs = require('fs');
const { TEMPLATE_PATH } = require('./config');
const dashboard = require('./dashboard');
const { getActiveYear, setActiveYear, getExcelPath, isSchedulerStopped, stopSchedulerForNumber, startSchedulerForNumber } = require('./config');
const {
    MONTHS, MONTH_DAYS, BUDGET_ROWS,
    readMonthValue, writeMonthValue,
    readMonthParts,  writeMonthParts,
    readBudgetValue, writeBudgetValue,
    getMonthSummary, getSectionTotals,
    generateMonthHtml, generateYearHtml,
    getMonthReport, getYearReport,
    getCategoryDayValues,
    readStartingBalance,
    writeStartingBalance,
    createYearTemplate
} = require('./excel');

// ── Sections & Categories ─────────────────────────────────────────────────────
const SECTIONS = {
    "INCOME":         ["Wages & Tips","Interest Income","Dividends","Gifts Received","Refunds/Reimbursements","Other","Transfer From Savings"],
    "Petty Cash Used":["Pocket Money Wife","Car Part","Food","Donation","Eidi","Other"],
    "SAVINGS EXPENSE":["Emergency Fund","Investments","Pocket Money Wife"],
    "HOME EXPENSES":  ["Mortgage/Rent","Electricity","Gas/Oil","Water/Sewer/Trash","Phone","Cable/Satellite","Internet","Furnishings/Appliances","Lawn/Garden","Home Supplies","Maintenance","Improvements","Other"],
    "DAILY LIVING":   ["Groceries","Personal Supplies","Clothing","Cleaning Services","Dining/Eating Out","Dry Cleaning","Salon/Barber","FoodPanda","JazzCash/EasyPaisa","Other"],
    "CHILDREN":       ["Medical","Clothing","School Tuition","School Lunch","School Supplies","Babysitting","Toys/Games","Other"],
    "TRANSPORTATION": ["Vehicle Payments","Fuel","Bus/Taxi/Train Fare","Repairs","Registration/License","Other"],
    "HEALTH":         ["Doctor/Dentist","Medicine/Drugs","Lab Test","Consultation","Other"],
    "EDUCATION":      ["Tuition","Books","Music Lessons","Other"],
    "CHARITY/GIFTS":  ["Gifts Given","Couple Charity","Mother Charity","Other"],
    "OBLIGATIONS":    ["Credit Card Debt","Punjab ST on CC Fee @16","Advance Tax 5%","Other"],
    "ENTERTAINMENT":  ["Activities","Books","Games","Fun Stuff","Hobbies","Media","Outdoor Recreation","Sports","Toys/Gadgets","Vacation/Travel","Other"],
    "SUBSCRIPTIONS":  ["Netflix","Medium","Youtube","Google One","Hetzner VM","Claude Ai"],
    "VACATION":       ["Travel","Lodging","Food","Rental Car","Entertainment","Other"],
    "MISCELLANEOUS":  ["Bank Fees","Postage","Other"],
};
const SECTION_NAMES = Object.keys(SECTIONS);
const BUDGET_FIELDS = Object.keys(BUDGET_ROWS);

// ── Sessions ──────────────────────────────────────────────────────────────────
const sessions = {};
function getSession(phone) {
    if (!sessions[phone]) sessions[phone] = { state: 'idle', data: {} };
    return sessions[phone];
}
function setState(phone, state, extra = {}) {
    const s = getSession(phone);
    s.state = state;
    Object.assign(s.data, extra);
}
function clearSession(phone) {
    sessions[phone] = { state: 'idle', data: {} };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const LINE  = '───────────────────';
const DLINE = '═══════════════════';
// ── Conflict resolution helpers ────────────────────────────────────────────────
function fmtParts(parts) {
    return parts.map((v, i) => `  *${i + 1}.*  ${fmtNum(v)}`).join('\n');
}

function conflictMenuMsg(data, day, parts, total) {
    return [
        `⚠️ *Value Exists — Day ${day}*`,
        DLINE,
        `📂  ${data.section}`,
        `🏷️  ${data.category}`,
        `📆  ${data.month} 2026  ·  Day ${day}`,
        LINE,
        `Current formula parts:`,
        fmtParts(parts),
        `  _Total: *${fmtNum(total)}*_`,
        LINE,
        `What would you like to do?`,
        `*1* 📎 *Append*  — add a new value to the formula`,
        `*2* 🗑 *Delete*  — remove one part from the formula`,
        `*3* ✏️ *Change*  — change one part's value`,
        `*4* 🔄 *Replace* — replace entirely with a new value`,
        `*5* ➕ *Add*     — overwrite with a single plain value`,
        `*0* ⬅ Cancel`,
    ].join('\n');
}

function partsListMsg(data, day, parts, action) {
    return [
        `${action === 'delete' ? '🗑' : '✏️'} *${action === 'delete' ? 'Delete' : 'Change'} a Part*`,
        DLINE,
        `📂  ${data.section}  ›  ${data.category}`,
        `📆  Day ${day}  ·  ${data.month} 2026`,
        LINE,
        `Choose which part to ${action}:`,
        fmtParts(parts),
        ``,
        `*0* ⬅ Back`,
    ].join('\n');
}



function isBack(text) {
    return text === '0' || text.toLowerCase() === 'back';
}
function pick(arr, text) {
    const n = parseInt(text.trim(), 10);
    if (isNaN(n) || n < 1 || n > arr.length) return null;
    return arr[n - 1];
}
function fmt(v) {
    if (v === null || v === undefined || v === 0) return '_empty_';
    return Number(v).toLocaleString();
}
function fmtNum(n) { return Number(n || 0).toLocaleString(); }
function crumb(...parts) { return parts.join(' › '); }

// ── Screen generators ─────────────────────────────────────────────────────────

function screenMainMenu(phone) {
    const yr = getActiveYear() || '—';
    return [
        `🤖 *Gofy Assistant*`,
        `_Active Year: *${yr}*_`,
        DLINE,
        ``,
        `*📅 1*  Enter Expense / Income`,
        `*🏦 2*  Update Budget`,
        `*📊 3*  View Summary`,
        `*📎 4*  Download Excel File`,
        `*🌐 5*  Export HTML Report`,
        `*📋 6*  Create New Year Template`,
        `*🔄 7*  Switch Active Year`,
        `*${isSchedulerStopped(phone) ? '▶️' : '⏸'} 8*  ${isSchedulerStopped(phone) ? 'Resume' : 'Stop'} Scheduled Backups`,
        `*📊 9*  View Dashboard`,
        ``,
        LINE,
        `_Reply with a number  •  *help* for commands_`,
    ].join('\n');
}
function screenSelectMonth(context = 'Select Month') {
    const cols = MONTHS.map((m, i) =>
        `  *${String(i + 1).padStart(2)}*  ${m}`
    ).join('\n');
    return [
        `📅 *${context}*`,
        LINE,
        cols,
        LINE,
        `  *0*  ⬅ Back`,
        ``,
        `_Reply with month number_`,
    ].join('\n');
}

function screenSelectSection(month) {
    const list = SECTION_NAMES.map((s, i) =>
        `  *${String(i + 1).padStart(2)}*  ${s}`
    ).join('\n');
    return [
        `📂 *${crumb(month + ' 2026', 'Section')}*`,
        LINE,
        list,
        LINE,
        `  *0*  ⬅ Back`,
        ``,
        `_Reply with number  •  *?N* to preview (e.g. ?4)_`,
    ].join('\n');
}

async function screenSelectCategory(month, section) {
    const cats = SECTIONS[section];
    const totals = await getSectionTotals(month, section, cats);
    const list = cats.map((cat, i) => {
        const val = totals[cat];
        const valStr = val ? `*${Number(val).toLocaleString()}*` : `_—_`;
        return `  *${String(i + 1).padStart(2)}*  ${cat}  ${valStr}`;
    }).join('\n');
    return [
        `📋 *${crumb(month + ' 2026', section)}*`,
        `_Monthly totals shown_`,
        LINE,
        list,
        LINE,
        `  *0*  ⬅ Back`,
        ``,
        `_Reply with number to edit_`,
    ].join('\n');
}

async function screenSelectDay(month, section, category) {
    const maxDay = MONTH_DAYS[month];
    const filled = await getCategoryDayValues(month, section, category);
    const filledDays = Object.keys(filled).map(Number).sort((a, b) => a - b);
    const filledLines = filledDays.length > 0
        ? filledDays.map(d => `  📅 Day *${String(d).padStart(2,'0')}*  →  ${Number(filled[d]).toLocaleString()}`).join('\n')
        : `  _No entries yet_`;
    return [
        `📆 *${crumb(month + ' 2026', section, category)}*`,
        LINE,
        `*Filled days:*`,
        filledLines,
        LINE,
        `Enter day to add/update *(1 – ${maxDay})*:`,
        `  *0*  ⬅ Back`,
        `_e.g. reply *15* for the 15th_`,
    ].join('\n');
}

function screenBudgetSelectField() {
    const list = [
        ...BUDGET_FIELDS.map((f, i) => `  *${i + 1}*  ${f}`),
        `  *${BUDGET_FIELDS.length + 1}*  Starting Balance`
    ].join('\n');
    return [
        `🏦 *Budget Update*`,
        LINE,
        `Which field would you like to update?`,
        ``,
        list,
        LINE,
        `  *0*  ⬅ Back`,
        ``,
        `_Reply with number_`,
    ].join('\n');
}

function screenBudgetSelectMonth(field) {
    const cols = MONTHS.map((m, i) =>
        `  *${String(i + 1).padStart(2)}*  ${m}`
    ).join('\n');
    return [
        `🏦 *${crumb('Budget', field)}*`,
        LINE,
        `Select month:`,
        ``,
        cols,
        LINE,
        `  *0*  ⬅ Back`,
        ``,
        `_Reply with month number_`,
    ].join('\n');
}

function screenSummaryType() {
    return [
        `📊 *View Summary*`,
        LINE,
        `  *1*  📅  Month wise`,
        `  *2*  📆  Year wise`,
        LINE,
        `  *0*  ⬅ Back`,
        ``,
        `_Reply with number_`,
    ].join('\n');
}

function screenSummarySelectMonth() {
    const cols = MONTHS.map((m, i) =>
        `  *${String(i + 1).padStart(2)}*  ${m}`
    ).join('\n');
    return [
        `📊 *View Summary*`,
        LINE,
        `Select month:`,
        ``,
        cols,
        LINE,
        `  *0*  ⬅ Back`,
        ``,
        `_Reply with month number_`,
    ].join('\n');
}

function screenReportSelect() {
    return [
        `🌐 *Export HTML Report*`,
        LINE,
        `  *1*  📅  Month detail  _(one month, all sections)_`,
        `  *2*  📊  Year overview  _(all 12 months with tabs)_`,
        LINE,
        `  *0*  ⬅ Back`,
        ``,
        `_Reply with number_`,
    ].join('\n');
}

function formatSummary(title, d) {
    const Nf = n => (n || 0).toLocaleString();
    const sg = n => n >= 0 ? '+' : '';
    const net = d.net !== undefined ? d.net : (d.totalIncome - d.totalExpenses);
    return [
        `📊 *${title}*`,
        DLINE,
        ``,
        `🏦 *Bank*`,
        LINE,
        `  Income       *${Nf(d.totalIncome)}*`,
        `  Expenses      *${Nf(d.totalExpenses)}*`,
        `  Net           *${sg(net)}${Nf(net)}*`,
        ``,
        `💵 *Petty Cash*`,
        LINE,
        `  Available     *${Nf(d.pettyCashAvailable)}*`,
        `  Used          *${Nf(d.pettyCashUsed)}*`,
        `  Left          *${Nf(d.pettyCashLeft)}*`,
        ``,
        `⚖️ *Balance*`,
        LINE,
        ...(d.startingBalance ? [`  Initial       *${Nf(d.startingBalance)}*`] : []),
        `  Bank          *${Nf(d.balanceBank)}*`,
        `  Petty + Bank  *${Nf(d.balancePettyBank)}*`,
        ``,
        `_Send *Gofy* to continue._`,
    ].join('\n');
}

function screenDashboardMenu() {
    const running = dashboard.isRunning();
    return [
        `📊 *Monitoring Dashboard*`,
        DLINE,
        `  *1*  🔗  Preview  _(get your access link)_`,
        `  *2*  🔑  Generate Access Token  _(paste on login page)_`,
        `  *3*  ${running ? '⏹  Stop' : '▶️  Start'} Dashboard Server`,
        LINE,
        `  *0*  ⬅ Back`,
        ``,
        `_Reply with number_`,
    ].join('\n');
}

// ── Main handler ──────────────────────────────────────────────────────────────
async function handleMessage(phone, text) {
    const s = getSession(phone);
    const { state, data } = s;
    text = text.trim();

    // ── Global commands ───────────────────────────────────────────────────────
    if (['cancel','exit','quit','stop','reset'].includes(text.toLowerCase())) {
        clearSession(phone);
        return [
            `🔄 *Session reset.*`,
            LINE,
            `*Gofy*  →  Open main menu`,
            `*help*  →  Show available commands`,
        ].join('\n');
    }
    if (text.toLowerCase() === 'help') {
        return [
            `🤖 *SavingHomeLab — Help*`,
            DLINE,
            `*Gofy*  →  Open main menu`,
            `*0* or *back*    →  Go back one step`,
            `*cancel*         →  Exit current session`,
            `*?N*             →  Preview section N`,
            `*help*           →  Show this message`,
            `*stop schedule*  →  Stop auto file backups`,
            `*start schedule* →  Resume auto file backups`,
            LINE,
            `_Only authorised numbers can use this bot._`,
            `_All data is saved to Saving-2026.xlsx._`,
        ].join('\n');
    }

    // ── Scheduler toggle (works from any state) ───────────────────────────────
    if (text.toLowerCase() === 'stop schedule') {
        stopSchedulerForNumber(phone);
        return [
            `⏸ *Scheduler stopped for you.*`,
            LINE,
            `You will no longer receive scheduled file backups.`,
            `Send *start schedule* to resume.`,
        ].join('\n');
    }
    if (text.toLowerCase() === 'start schedule') {
        startSchedulerForNumber(phone);
        return [
            `▶️ *Scheduler resumed for you.*`,
            LINE,
            `You will receive scheduled file backups at:`,
            `  11:15 AM  •  4:20 PM  •  8:30 PM  •  11:50 PM`,
            `_Send *stop schedule* to pause again._`,
        ].join('\n');
    }

    // ── IDLE ──────────────────────────────────────────────────────────────────
    if (state === 'idle') {
        if (text.toLowerCase() === 'gofy') {
            if (!getActiveYear()) {
                setState(phone, 'setup_year');
                return [
                    `🤖 *Welcome to Gofy Assistant!*`,
                    DLINE,
                    `No active year is set yet.`,
                    ``,
                    `What year are you budgeting for?`,
                    `_e.g. *2026*_`,
                ].join('\n');
            }
            setState(phone, 'main_menu');
            return screenMainMenu(phone);
        }
        return [
            `👋 *Hello!*`,
            LINE,
            `*Gofy*  →  Open main menu`,
            `*help*  →  Show available commands`,
        ].join('\n');
    }

    // ── FIRST-TIME YEAR SETUP ─────────────────────────────────────────────────
    if (state === 'setup_year') {
        const yr = parseInt(text.trim(), 10);
        if (isNaN(yr) || yr < 2024 || yr > 2099) return `⚠️ Enter a valid year (e.g. *2026*).`;
        setActiveYear(yr);
        setState(phone, 'main_menu');
        return [
            `✅ *Active year set to ${yr}*`,
            `_Reading: Saving-${yr}/Saving-${yr}.xlsx_`,
            ``,
            screenMainMenu(phone),
        ].join('\n');
    }

    // ── MAIN MENU ─────────────────────────────────────────────────────────────
    if (state === 'main_menu') {
        if (isBack(text)) { clearSession(phone); return `👋 _Session closed. Send *Gofy* to begin._`; }
        if (text === '1') { setState(phone, 'select_month', { mode: 'monthly' }); return screenSelectMonth('Monthly Entry › Select Month'); }
        if (text === '2') { setState(phone, 'budget_select_field'); return screenBudgetSelectField(); }
        if (text === '3') { setState(phone, 'summary_type'); return screenSummaryType(); }
        if (text === '4') { clearSession(phone); return { type: 'file', path: getExcelPath(), caption: `📎 *Saving-${getActiveYear()}.xlsx*` }; }
        if (text === '5') { setState(phone, 'report_select'); return screenReportSelect(); }
        if (text === '6') { setState(phone, 'new_year_enter'); return [
            `📋 *Create New Year Template*`,
            LINE,
            `Enter the year for the new budget file:`,
            `_e.g. *2027*_`,
            ``,
            `  *0*  ⬅ Back`,
        ].join('\n'); }
        if (text === '7') {
            setState(phone, 'switch_year');
            const yr = getActiveYear();
            return [
                `🔄 *Switch Active Year*`,
                LINE,
                `Current year: *${yr}*`,
                ``,
                `Enter the year to switch to:`,
                `_e.g. *2027*  (file must exist in Saving-2027/ folder)_`,
                ``,
                `  *0*  ⬅ Back`,
            ].join('\n');
        }
        if (text === '8') {
            if (isSchedulerStopped(phone)) {
                startSchedulerForNumber(phone);
                return [
                    `▶️ *Scheduled Backups Resumed*`,
                    LINE,
                    `You will receive files at:`,
                    `  11:15 AM  •  4:20 PM  •  8:30 PM  •  11:50 PM PKT`,
                    ``,
                    `_Send *Gofy* to return to menu._`,
                ].join('\n');
            } else {
                stopSchedulerForNumber(phone);
                return [
                    `⏸ *Scheduled Backups Stopped*`,
                    LINE,
                    `You will no longer receive scheduled file backups.`,
                    `Select option *8* again to resume.`,
                    ``,
                    `_Send *Gofy* to return to menu._`,
                ].join('\n');
            }
        }
        if (text === '9') {
            setState(phone, 'dashboard_menu');
            return screenDashboardMenu();
        }
        return `⚠️ *Invalid choice.* Reply with *1 – 9*.`;
    }

    // ── SUMMARY: TYPE ─────────────────────────────────────────────────────────
    if (state === 'summary_type') {
        if (isBack(text)) { setState(phone, 'main_menu'); return screenMainMenu(phone); }
        if (text === '1') { setState(phone, 'summary_select_month'); return screenSummarySelectMonth(); }
        if (text === '2') {
            setState(phone, 'summary_year');
            return [`📆 *Year Summary*`, LINE, `  *1*  2026`, LINE, `  *0*  ⬅ Back`, ``, `_Reply with number_`].join('\n');
        }
        return `⚠️ *Invalid.* Reply *1*, *2*, or *0* to go back.`;
    }

    // ── SUMMARY: MONTH ────────────────────────────────────────────────────────
    if (state === 'summary_select_month') {
        if (isBack(text)) { setState(phone, 'summary_type'); return screenSummaryType(); }
        const month = pick(MONTHS, text);
        if (!month) return `⚠️ *Invalid.* Reply *1 – ${MONTHS.length}* or *0* to go back.`;
        const d = await getMonthReport(month);
        clearSession(phone);
        if (!d) return `⚠️ No data found for ${month} 2026.`;
        return formatSummary(`${month} 2026 — Summary`, d);
    }

    // ── SUMMARY: YEAR ─────────────────────────────────────────────────────────
    if (state === 'summary_year') {
        if (isBack(text)) { setState(phone, 'summary_type'); return screenSummaryType(); }
        if (text === '1') {
            const d = await getYearReport();
            const yr = getActiveYear();
            clearSession(phone);
            const Nf = n => (n || 0).toLocaleString();
            const sg = n => n >= 0 ? '+' : '';
            const monthBlocks = MONTHS.map(m => {
                const md = d.monthly[m];
                if (!md || md.net === 0) return null;
                const pcLeft = md.pettyCashLeft || 0;
                const total  = md.net + pcLeft;
                return [
                    `*${m}*`,
                    `  Net:      ${sg(md.net)}${Nf(md.net)}`,
                    `  PC Left:  ${Nf(pcLeft)}`,
                    `  Total:    ${sg(total)}${Nf(total)}`,
                ].join('\n');
            }).filter(Boolean).join('\n\n');
            const breakdown = monthBlocks ? ['', '📅 *Month-wise Saving*', LINE, monthBlocks].join('\n') : '';
            const startLine = d.startingBalance ? ['', `💼 *Initial Balance:  ${Nf(d.startingBalance)}*`].join('\n') : '';
            return formatSummary(`${yr} Year Summary`, {
                totalIncome: d.totalIncome, totalExpenses: d.totalExpenses, net: d.net,
                pettyCashAvailable: d.pettyCashAvailable, pettyCashUsed: d.pettyCashUsed, pettyCashLeft: d.pettyCashLeft,
                balanceBank: d.balanceBank, balancePettyBank: d.balancePettyBank,
                startingBalance: d.startingBalance,
            }) + startLine + breakdown;
        }
        return `⚠️ *Invalid.* Reply *1* for 2026 or *0* to go back.`;
    }

    // ── MONTHLY: SELECT MONTH ─────────────────────────────────────────────────
    if (state === 'select_month') {
        if (isBack(text)) { setState(phone, 'main_menu'); return screenMainMenu(phone); }
        const month = pick(MONTHS, text);
        if (!month) return `⚠️ *Invalid.* Reply with *1 – ${MONTHS.length}* or *0* to go back.`;
        setState(phone, 'select_section', { month });
        return screenSelectSection(month);
    }

    // ── MONTHLY: SELECT SECTION ───────────────────────────────────────────────
    if (state === 'select_section') {
        if (isBack(text)) { setState(phone, 'select_month'); return screenSelectMonth('Monthly Entry › Select Month'); }

        const previewMatch = text.match(/^\?(\d+)$/);
        if (previewMatch) {
            const section = pick(SECTION_NAMES, previewMatch[1]);
            if (!section) return `⚠️ *Invalid.* Try *?1* – *?${SECTION_NAMES.length}*.`;
            const cats = SECTIONS[section].map((c, i) => `  *${i + 1}*  ${c}`).join('\n');
            return [
                `🔍 *${section}* — Categories`,
                LINE,
                cats,
                LINE,
                `_Reply with a section number to select, or *?N* to preview another._`,
            ].join('\n');
        }

        const section = pick(SECTION_NAMES, text);
        if (!section) return `⚠️ *Invalid.* Reply *1 – ${SECTION_NAMES.length}*, *?N* to preview, or *0* to go back.`;
        setState(phone, 'select_category', { section });
        return await screenSelectCategory(data.month, section);
    }

    // ── MONTHLY: SELECT CATEGORY ──────────────────────────────────────────────
    if (state === 'select_category') {
        if (isBack(text)) { setState(phone, 'select_section'); return screenSelectSection(data.month); }
        const cats = SECTIONS[data.section];
        const cat = pick(cats, text);
        if (!cat) return `⚠️ *Invalid.* Reply *1 – ${cats.length}* or *0* to go back.`;
        setState(phone, 'select_day', { category: cat });
        return await screenSelectDay(data.month, data.section, cat);
    }

    // ── MONTHLY: SELECT DAY ───────────────────────────────────────────────────
    if (state === 'select_day') {
        if (isBack(text)) { setState(phone, 'select_category'); return await screenSelectCategory(data.month, data.section); }
        const day = parseInt(text, 10);
        const maxDay = MONTH_DAYS[data.month];
        if (isNaN(day) || day < 1 || day > maxDay) return `⚠️ *Invalid day.* Enter *1 – ${maxDay}* or *0* to go back.`;
        const rawCell = await readMonthParts(data.month, data.section, data.category, day);
        if (rawCell.parts && rawCell.parts.length > 0) {
            // Cell already has data — show conflict resolution menu
            setState(phone, 'conflict_menu', { day, existingParts: rawCell.parts, existingTotal: rawCell.total });
            return conflictMenuMsg(data, day, rawCell.parts, rawCell.total);
        }
        // Cell empty — normal flow
        setState(phone, 'enter_amount', { day });
        return [
            `✏️ *${crumb(data.month + ' 2026', data.section, data.category)}*`,
            `📆 Day *${day}*  —  _cell is empty_`,
            LINE,
            `Enter the amount:`,
            `_Numbers only  •  *0* clears the cell  •  *back* to go back_`,
        ].join('\n');
    }

    // ── CONFLICT MENU ─────────────────────────────────────────────────────────
    if (state === 'conflict_menu') {
        if (isBack(text) || text === '0') {
            setState(phone, 'select_day');
            return await screenSelectDay(data.month, data.section, data.category);
        }
        const { existingParts, existingTotal, day } = data;

        if (text === '1') {  // Append
            setState(phone, 'conflict_append');
            return [
                `📎 *Append Value*`,
                LINE,
                `Current: ${fmtParts(existingParts)}`,
                `  _Total: *${fmtNum(existingTotal)}*_`,
                LINE,
                `Enter the value to *append* to the formula:`,
                `_*back* to go back_`,
            ].join('\n');
        }
        if (text === '2') {  // Delete
            setState(phone, 'conflict_delete');
            return partsListMsg(data, day, existingParts, 'delete');
        }
        if (text === '3') {  // Change
            setState(phone, 'conflict_change_pick');
            return partsListMsg(data, day, existingParts, 'change');
        }
        if (text === '4') {  // Replace (formula)
            setState(phone, 'conflict_replace');
            return [
                `🔄 *Replace Value*`,
                LINE,
                `Current: ${fmtParts(existingParts)}`,
                `  _Total: *${fmtNum(existingTotal)}*_`,
                LINE,
                `Enter the new value to *replace* the formula with:`,
                `_This will store it as a single formula  •  *back* to go back_`,
            ].join('\n');
        }
        if (text === '5') {  // Add (plain number)
            setState(phone, 'conflict_add');
            return [
                `➕ *Overwrite with Plain Value*`,
                LINE,
                `Current: ${fmtParts(existingParts)}`,
                `  _Total: *${fmtNum(existingTotal)}*_`,
                LINE,
                `Enter the value to *overwrite* the cell with (plain number, no formula):`,
                `_*back* to go back_`,
            ].join('\n');
        }
        return `⚠️ Reply *1* Append · *2* Delete · *3* Change · *4* Replace · *5* Add · *0* Cancel`;
    }

    // ── CONFLICT: APPEND ──────────────────────────────────────────────────────
    if (state === 'conflict_append') {
        if (isBack(text)) {
            setState(phone, 'conflict_menu');
            return conflictMenuMsg(data, data.day, data.existingParts, data.existingTotal);
        }
        const amt = parseFloat(text.replace(/,/g, ''));
        if (isNaN(amt) || amt <= 0) return `⚠️ Enter a positive number, or *back* to go back.`;
        const newParts = [...data.existingParts, amt];
        const result   = await writeMonthParts(data.month, data.section, data.category, data.day, newParts, true);
        clearSession(phone);
        if (result.ok) {
            const formula = newParts.map(fmtNum).join(' + ');
            return [
                `✅ *Appended!*`,
                LINE,
                `📅  ${data.month} 2026  ·  Day ${data.day}`,
                `📂  ${data.section}  ›  ${data.category}`,
                `📐  Formula: *${formula}*`,
                `💰  Total:   *${fmtNum(newParts.reduce((a, b) => a + b, 0))}*`,
                ``,
                `_Send *Gofy* to continue._`,
            ].join('\n');
        }
        return `❌ *Error:* ${result.error}\n_Send *Gofy* to try again._`;
    }

    // ── CONFLICT: DELETE ──────────────────────────────────────────────────────
    if (state === 'conflict_delete') {
        if (isBack(text) || text === '0') {
            setState(phone, 'conflict_menu');
            return conflictMenuMsg(data, data.day, data.existingParts, data.existingTotal);
        }
        const idx = parseInt(text, 10) - 1;
        const { existingParts, day } = data;
        if (isNaN(idx) || idx < 0 || idx >= existingParts.length)
            return `⚠️ Enter a number between *1* and *${existingParts.length}*, or *0* to go back.`;
        const removed  = existingParts[idx];
        const newParts = existingParts.filter((_, i) => i !== idx);
        const asFormula = newParts.length > 1;
        const result   = await writeMonthParts(data.month, data.section, data.category, day, newParts, asFormula);
        clearSession(phone);
        if (result.ok) {
            const display = newParts.length === 0
                ? '_cell cleared_'
                : newParts.length === 1
                    ? `*${fmtNum(newParts[0])}*`
                    : `*${newParts.map(fmtNum).join(' + ')}* = *${fmtNum(newParts.reduce((a, b) => a + b, 0))}*`;
            return [
                `✅ *Deleted!*`,
                LINE,
                `📅  ${data.month} 2026  ·  Day ${day}`,
                `📂  ${data.section}  ›  ${data.category}`,
                `🗑  Removed: *${fmtNum(removed)}*`,
                `📐  Remaining: ${display}`,
                ``,
                `_Send *Gofy* to continue._`,
            ].join('\n');
        }
        return `❌ *Error:* ${result.error}\n_Send *Gofy* to try again._`;
    }

    // ── CONFLICT: CHANGE (PICK PART) ──────────────────────────────────────────
    if (state === 'conflict_change_pick') {
        if (isBack(text) || text === '0') {
            setState(phone, 'conflict_menu');
            return conflictMenuMsg(data, data.day, data.existingParts, data.existingTotal);
        }
        const idx = parseInt(text, 10) - 1;
        const { existingParts, day } = data;
        if (isNaN(idx) || idx < 0 || idx >= existingParts.length)
            return `⚠️ Enter a number between *1* and *${existingParts.length}*, or *0* to go back.`;
        setState(phone, 'conflict_change_value', { changeIdx: idx });
        return [
            `✏️ *Change Part ${idx + 1}*`,
            LINE,
            `Replacing: *${fmtNum(existingParts[idx])}*`,
            ``,
            `Enter the *new value* for this part:`,
            `_Numbers only  •  *back* to go back_`,
        ].join('\n');
    }

    // ── CONFLICT: CHANGE (ENTER NEW VALUE) ───────────────────────────────────
    if (state === 'conflict_change_value') {
        if (isBack(text)) {
            setState(phone, 'conflict_change_pick');
            return partsListMsg(data, data.day, data.existingParts, 'change');
        }
        const newVal = parseFloat(text.replace(/,/g, ''));
        if (isNaN(newVal) || newVal <= 0) return `⚠️ Enter a positive number, or *back* to go back.`;
        const { existingParts, day, changeIdx } = data;
        const oldVal  = existingParts[changeIdx];
        const newParts = existingParts.map((v, i) => i === changeIdx ? newVal : v);
        const asFormula = newParts.length > 1;
        const result   = await writeMonthParts(data.month, data.section, data.category, day, newParts, asFormula);
        clearSession(phone);
        if (result.ok) {
            const formula = newParts.length === 1
                ? `*${fmtNum(newParts[0])}*`
                : `*${newParts.map(fmtNum).join(' + ')}* = *${fmtNum(newParts.reduce((a, b) => a + b, 0))}*`;
            return [
                `✅ *Changed!*`,
                LINE,
                `📅  ${data.month} 2026  ·  Day ${day}`,
                `📂  ${data.section}  ›  ${data.category}`,
                `✏️  Part ${changeIdx + 1}: *${fmtNum(oldVal)}* → *${fmtNum(newVal)}*`,
                `📐  New formula: ${formula}`,
                ``,
                `_Send *Gofy* to continue._`,
            ].join('\n');
        }
        return `❌ *Error:* ${result.error}\n_Send *Gofy* to try again._`;
    }

    // ── CONFLICT: REPLACE (formula =newValue) ─────────────────────────────────
    if (state === 'conflict_replace') {
        if (isBack(text)) {
            setState(phone, 'conflict_menu');
            return conflictMenuMsg(data, data.day, data.existingParts, data.existingTotal);
        }
        const newVal = parseFloat(text.replace(/,/g, ''));
        if (isNaN(newVal) || newVal <= 0) return `⚠️ Enter a positive number, or *back* to go back.`;
        // Replace: single-value formula (stored as plain number since it's one part)
        const result = await writeMonthParts(data.month, data.section, data.category, data.day, [newVal], false);
        clearSession(phone);
        if (result.ok) {
            return [
                `✅ *Replaced!*`,
                LINE,
                `📅  ${data.month} 2026  ·  Day ${data.day}`,
                `📂  ${data.section}  ›  ${data.category}`,
                `🔄  Old total: *${fmtNum(data.existingTotal)}*  →  New: *${fmtNum(newVal)}*`,
                ``,
                `_Send *Gofy* to continue._`,
            ].join('\n');
        }
        return `❌ *Error:* ${result.error}\n_Send *Gofy* to try again._`;
    }

    // ── CONFLICT: ADD (plain number overwrite) ────────────────────────────────
    if (state === 'conflict_add') {
        if (isBack(text)) {
            setState(phone, 'conflict_menu');
            return conflictMenuMsg(data, data.day, data.existingParts, data.existingTotal);
        }
        const newVal = parseFloat(text.replace(/,/g, ''));
        if (isNaN(newVal) || newVal <= 0) return `⚠️ Enter a positive number, or *back* to go back.`;
        const result = await writeMonthValue(data.month, data.section, data.category, data.day, newVal);
        clearSession(phone);
        if (result.ok) {
            return [
                `✅ *Saved!*`,
                LINE,
                `📅  ${data.month} 2026  ·  Day ${data.day}`,
                `📂  ${data.section}  ›  ${data.category}`,
                `➕  Value: *${fmtNum(newVal)}*  _(plain number — no formula)_`,
                ``,
                `_Send *Gofy* to continue._`,
            ].join('\n');
        }
        return `❌ *Error:* ${result.error}\n_Send *Gofy* to try again._`;
    }

        // ── MONTHLY: ENTER AMOUNT ─────────────────────────────────────────────────
    if (state === 'enter_amount') {
        if (text.toLowerCase() === 'back') { setState(phone, 'select_day'); return await screenSelectDay(data.month, data.section, data.category); }
        const amount = parseFloat(text.replace(/,/g, ''));
        if (isNaN(amount)) return `⚠️ *Invalid amount.* Enter a number, or *back* to go back.`;
        setState(phone, 'confirm_entry', { amount });
        return [
            `📋 *Confirm Entry*`,
            DLINE,
            `📅  Month       *${data.month} 2026*`,
            `📂  Section     *${data.section}*`,
            `🏷  Category    *${data.category}*`,
            `📆  Day         *${data.day}*`,
            `💰  Amount      *${fmtNum(amount)}${amount === 0 ? '  _(clears cell)_' : ''}*`,
            DLINE,
            `*1*  ✅  Confirm & Save`,
            `*2*  🔄  Change Amount`,
            `*3*  ❌  Cancel`,
            `*0*  ⬅  Back`,
        ].join('\n');
    }

    // ── MONTHLY: CONFIRM ──────────────────────────────────────────────────────
    if (state === 'confirm_entry') {
        if (isBack(text) || text === '2') {
            setState(phone, text === '2' ? 'enter_amount' : 'enter_amount');
            return [
                `✏️ *${crumb(data.month + ' 2026', data.section, data.category)}*`,
                `📆 Day *${data.day}*  —  Enter new amount:`,
                `_Numbers only  •  *0* clears  •  *back* to go back_`,
            ].join('\n');
        }
        if (text === '1') {
            const result = await writeMonthValue(data.month, data.section, data.category, data.day, data.amount);
            clearSession(phone);
            if (result.ok) {
                return [
                    `✅ *Saved!*`,
                    LINE,
                    `📅  ${data.month} 2026  •  Day ${data.day}`,
                    `📂  ${data.section}  ›  ${data.category}`,
                    `💰  *${fmtNum(data.amount)}*`,
                    ``,
                    `_Send *Gofy* to continue._`,
                ].join('\n');
            }
            return `❌ *Error:* ${result.error}\n_Send *Gofy* to try again._`;
        }
        if (text === '3') { clearSession(phone); return `❌ *Cancelled.*\n_Send *Gofy* to start again._`; }
        return `⚠️ Reply *1* to save, *2* to change amount, *3* to cancel, *0* to go back.`;
    }

    // ── BUDGET: SELECT FIELD ──────────────────────────────────────────────────
    if (state === 'budget_select_field') {
        if (isBack(text)) { setState(phone, 'main_menu'); return screenMainMenu(phone); }
        // "Starting Balance" is a special option beyond BUDGET_FIELDS
        if (parseInt(text) === BUDGET_FIELDS.length + 1) {
            const cur = await readStartingBalance();
            setState(phone, 'budget_starting_balance');
            return [
                `🏦 *Budget › Starting Balance*`,
                LINE,
                `Current value: *${fmtNum(cur.value)}*`,
                ``,
                `Enter the new starting balance:`,
                `_Numbers only  •  *back* to go back_`,
            ].join('\n');
        }
        const field = pick(BUDGET_FIELDS, text);
        if (!field) return `⚠️ *Invalid.* Reply *1*–*${BUDGET_FIELDS.length + 1}*, or *0* to go back.`;
        setState(phone, 'budget_select_month', { budget_field: field });
        return screenBudgetSelectMonth(field);
    }

    // ── BUDGET: STARTING BALANCE ──────────────────────────────────────────────
    if (state === 'budget_starting_balance') {
        if (text.toLowerCase() === 'back') { setState(phone, 'budget_select_field'); return screenBudgetSelectField(); }
        const amount = parseFloat(text.replace(/,/g, ''));
        if (isNaN(amount)) return `⚠️ *Invalid amount.* Enter a number, or *back* to go back.`;
        setState(phone, 'budget_starting_balance_confirm', { sb_amount: amount });
        return [
            `📋 *Confirm Starting Balance*`,
            DLINE,
            `💰  Amount      *${fmtNum(amount)}*`,
            DLINE,
            `*1*  ✅  Confirm & Save`,
            `*2*  🔄  Change Amount`,
            `*0*  ⬅  Back`,
        ].join('\n');
    }

    if (state === 'budget_starting_balance_confirm') {
        if (isBack(text) || text === '2') {
            setState(phone, 'budget_starting_balance');
            const cur = await readStartingBalance();
            return [`🏦 *Starting Balance*`, LINE, `Current: *${fmtNum(cur.value)}*`, ``, `Enter new amount:`, `_*back* to go back_`].join('\n');
        }
        if (text === '1') {
            const result = await writeStartingBalance(data.sb_amount);
            clearSession(phone);
            if (result.ok) {
                return [
                    `✅ *Starting Balance Updated!*`,
                    LINE,
                    `💰  *${fmtNum(data.sb_amount)}*`,
                    ``,
                    `_Send *Gofy* to continue._`,
                ].join('\n');
            }
            return `❌ *Error:* ${result.error}\n_Send *Gofy* to try again._`;
        }
        return `⚠️ Reply *1* to save, *2* to change, *0* to go back.`;
    }

    // ── BUDGET: SELECT MONTH ──────────────────────────────────────────────────
    if (state === 'budget_select_month') {
        if (isBack(text)) { setState(phone, 'budget_select_field'); return screenBudgetSelectField(); }
        const month = pick(MONTHS, text);
        if (!month) return `⚠️ *Invalid.* Reply *1 – ${MONTHS.length}* or *0* to go back.`;
        const result = await readBudgetValue(data.budget_field, month);
        const curVal = result.error ? '?' : fmt(result.value);
        setState(phone, 'budget_enter_amount', { budget_month: month });
        return [
            `🏦 *${crumb('Budget', data.budget_field, month + ' 2026')}*`,
            LINE,
            `Current value:  *${curVal}*`,
            ``,
            `Enter the new amount:`,
            `_Numbers only  •  *0* clears the cell  •  *back* to go back_`,
        ].join('\n');
    }

    // ── BUDGET: ENTER AMOUNT ──────────────────────────────────────────────────
    if (state === 'budget_enter_amount') {
        if (text.toLowerCase() === 'back') { setState(phone, 'budget_select_month'); return screenBudgetSelectMonth(data.budget_field); }
        const amount = parseFloat(text.replace(/,/g, ''));
        if (isNaN(amount)) return `⚠️ *Invalid amount.* Enter a number, or *back* to go back.`;
        setState(phone, 'budget_confirm', { budget_amount: amount });
        return [
            `📋 *Confirm Budget Update*`,
            DLINE,
            `🏦  Field       *${data.budget_field}*`,
            `📅  Month       *${data.budget_month} 2026*`,
            `💰  Amount      *${fmtNum(amount)}${amount === 0 ? '  _(clears cell)_' : ''}*`,
            DLINE,
            `*1*  ✅  Confirm & Save`,
            `*2*  🔄  Change Amount`,
            `*3*  ❌  Cancel`,
            `*0*  ⬅  Back`,
        ].join('\n');
    }

    // ── BUDGET: CONFIRM ───────────────────────────────────────────────────────
    if (state === 'budget_confirm') {
        if (isBack(text) || text === '2') {
            setState(phone, 'budget_enter_amount');
            return [
                `🏦 *${crumb('Budget', data.budget_field, data.budget_month + ' 2026')}*`,
                `Enter new amount:`,
                `_Numbers only  •  *0* clears  •  *back* to go back_`,
            ].join('\n');
        }
        if (text === '1') {
            const result = await writeBudgetValue(data.budget_field, data.budget_month, data.budget_amount);
            clearSession(phone);
            if (result.ok) {
                return [
                    `✅ *Budget Updated!*`,
                    LINE,
                    `🏦  ${data.budget_field}`,
                    `📅  ${data.budget_month} 2026`,
                    `💰  *${fmtNum(data.budget_amount)}*`,
                    ``,
                    `_Send *Gofy* to continue._`,
                ].join('\n');
            }
            return `❌ *Error:* ${result.error}\n_Send *Gofy* to try again._`;
        }
        if (text === '3') { clearSession(phone); return `❌ *Cancelled.*\n_Send *Gofy* to start again._`; }
        return `⚠️ Reply *1* to save, *2* to change amount, *3* to cancel, *0* to go back.`;
    }

    // ── REPORT: SELECT TYPE ───────────────────────────────────────────────────
    if (state === 'report_select') {
        if (isBack(text)) { setState(phone, 'main_menu'); return screenMainMenu(phone); }
        if (text === '1') {
            setState(phone, 'report_select_month');
            return screenSelectMonth('HTML Report › Select Month');
        }
        if (text === '2') {
            clearSession(phone);
            const html = await generateYearHtml();
            const tmpPath = path.join(__dirname, '_report_year.html');
            fs.writeFileSync(tmpPath, html);
            return { type: 'file', path: tmpPath, caption: '🌐 *2026 Year Overview*\nOpen in your browser for the full interactive report.' };
        }
        return `⚠️ *Invalid.* Reply *1* or *2*, or *0* to go back.`;
    }

    // ── REPORT: SELECT MONTH ──────────────────────────────────────────────────
    if (state === 'report_select_month') {
        if (isBack(text)) { setState(phone, 'report_select'); return screenReportSelect(); }
        const month = pick(MONTHS, text);
        if (!month) return `⚠️ *Invalid.* Reply *1 – ${MONTHS.length}* or *0* to go back.`;
        clearSession(phone);
        const html = await generateMonthHtml(month);
        const tmpPath = path.join(__dirname, `_report_${month}.html`);
        fs.writeFileSync(tmpPath, html);
        return { type: 'file', path: tmpPath, caption: `🌐 *${month} 2026 Report*\nOpen in your browser for the full interactive report.` };
    }

    // ── SWITCH ACTIVE YEAR ────────────────────────────────────────────────────
    if (state === 'switch_year') {
        if (isBack(text)) { setState(phone, 'main_menu'); return screenMainMenu(phone); }
        const yr = parseInt(text.trim(), 10);
        if (isNaN(yr) || yr < 2024 || yr > 2099) return `⚠️ Enter a valid year (2024–2099) or *0* to go back.`;
        const excelPath = getExcelPath(yr);
        if (!require('fs').existsSync(excelPath)) {
            return [
                `⚠️ *File not found:*`,
                `_Saving-${yr}/Saving-${yr}.xlsx_`,
                ``,
                `Create it first via *option 6* then try again.`,
                `Or enter a different year, or *0* to go back.`,
            ].join('\n');
        }
        setActiveYear(yr);
        setState(phone, 'main_menu');
        return [
            `✅ *Switched to ${yr}*`,
            `_Now reading: Saving-${yr}/Saving-${yr}.xlsx_`,
            ``,
            screenMainMenu(phone),
        ].join('\n');
    }

    // ── NEW YEAR TEMPLATE: ENTER YEAR ────────────────────────────────────────
    if (state === 'new_year_enter') {
        if (isBack(text)) { setState(phone, 'main_menu'); return screenMainMenu(phone); }
        const yr = parseInt(text.trim(), 10);
        if (isNaN(yr) || yr < 2024 || yr > 2099) return `⚠️ Enter a valid year (2024–2099) or *0* to go back.`;
        setState(phone, 'new_year_confirm', { new_year: yr });
        return [
            `📋 *Confirm New Year Template*`,
            DLINE,
            `📅  Year        *${yr}*`,
            `💾  File        *Saving-${yr}.xlsx*`,
            DLINE,
            `*1*  ✅  Create & Download`,
            `*2*  🔄  Change Year`,
            `*0*  ⬅  Back`,
        ].join('\n');
    }

    // ── NEW YEAR TEMPLATE: CONFIRM ────────────────────────────────────────────
    if (state === 'new_year_confirm') {
        if (isBack(text) || text === '2') {
            setState(phone, 'new_year_enter');
            return [`📋 *Create New Year Template*`, LINE, `Enter the year:`, `_e.g. *2027*_`, ``, `  *0*  ⬅ Back`].join('\n');
        }
        if (text === '1') {
            const yr = data.new_year;
            clearSession(phone);
            try {
                const result = await createYearTemplate(yr, TEMPLATE_PATH);
                return {
                    type: 'file',
                    path: result.path,
                    caption: `📋 *Saving-${yr}.xlsx*\nSaved to Saving-${yr}/ folder.\nGo to menu → *Switch Year* to activate it.`
                };
            } catch (err) {
                console.error('Template creation error:', err);
                return `❌ *Error creating template:* ${err.message}\n_Make sure Template.xlsx is in the bot folder. Send *Gofy* to try again._`;
            }
        }
        return `⚠️ Reply *1* to create, *2* to change year, *0* to go back.`;
    }

    // ── DASHBOARD MENU ────────────────────────────────────────────────────────
    if (state === 'dashboard_menu') {
        if (isBack(text)) { setState(phone, 'main_menu'); return screenMainMenu(phone); }

        if (text === '1') {
            if (!dashboard.isRunning()) dashboard.startDashboard();
            const link = await dashboard.generateShortLink(phone);
            clearSession(phone);
            return [
                `🔗 *Your Dashboard Link*`,
                DLINE,
                link,
                ``,
                `🔒 Only your number can use this link`,
                `📊 Live updates • no expiry`,
                ``,
                `_Send *Gofy* to return to menu._`,
            ].join('\n');
        }

        if (text === '2') {
            if (!dashboard.isRunning()) dashboard.startDashboard();
            const token = dashboard.getRawToken(phone);
            clearSession(phone);
            return [
                `🔑 *Your Access Token*`,
                DLINE,
                `\`${token}\``,
                ``,
                `📋 Copy & paste this on the dashboard login page`,
                `🔒 No expiry • reusable`,
                ``,
                `_Send *Gofy* to return to menu._`,
            ].join('\n');
        }

        if (text === '3') {
            if (dashboard.isRunning()) {
                const res = dashboard.stopDashboard();
                clearSession(phone);
                return [`⏹ *Dashboard Stopped*`, LINE, `All sessions cleared.`, ``, `_Send *Gofy* to return to menu._`].join('\n');
            } else {
                const res = dashboard.startDashboard();
                clearSession(phone);
                return res.ok
                    ? [`▶️ *Dashboard Started*`, LINE, `Send *9 → 1* to get your access link.`, ``, `_Send *Gofy* to return to menu._`].join('\n')
                    : [`⚠️ ${res.msg}`, ``, `_Send *Gofy* to return to menu._`].join('\n');
            }
        }

        return `⚠️ *Invalid.* Reply *1*, *2*, *3*, or *0* to go back.`;
    }

    // ── Fallback ──────────────────────────────────────────────────────────────
    setState(phone, 'main_menu');
    return [
        `⚠️ _Session was reset._`,
        ``,
        screenMainMenu(phone),
    ].join('\n');
}

module.exports = { handleMessage };