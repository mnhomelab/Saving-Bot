<div align="center">

# 🤖 Saving-Bot-v0.1

**A private WhatsApp budget management bot for your homelab — no cloud, no subscriptions, no fees.**

Track income, expenses, petty cash and savings directly from WhatsApp, backed by your own Excel file.

[![Node.js](https://img.shields.io/badge/Node.js-20-green?style=flat-square&logo=node.js)](https://nodejs.org)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Web.js-25D366?style=flat-square&logo=whatsapp)](https://github.com/pedroslopez/whatsapp-web.js)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker)](https://docker.com)
[![ExcelJS](https://img.shields.io/badge/ExcelJS-4.x-217346?style=flat-square)](https://github.com/exceljs/exceljs)

</div>

---

## 📖 Table of Contents

- [What Is This?](#-what-is-this)
- [Use Cases](#-use-cases)
- [Features](#-features)
- [Prerequisites](#-prerequisites)
- [Folder Structure](#-folder-structure)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Adding WhatsApp Numbers to Whitelist](#-adding-whatsapp-numbers-to-whitelist)
- [Creating Your Year Excel File](#-creating-your-year-excel-file)
- [Bot Keywords](#-bot-keywords)
- [WhatsApp Conversation Flow](#-whatsapp-conversation-flow)
- [HTML Reports](#-html-reports)
- [Scheduled Backups](#-scheduled-backups)
- [Troubleshooting](#-troubleshooting)

---

## 💡 What Is This?

Saving-Bot-v0.1 is a **self-hosted WhatsApp budget assistant** that runs on your homelab (Raspberry Pi, Mini PC, VPS, or any always-on Linux machine). It connects to WhatsApp using your own second SIM number and lets authorised family members record expenses and view financial summaries — all through a simple WhatsApp menu.

Your financial data never leaves your home network. No monthly fees, no third-party APIs, no ads.

```
Your Phone ──WhatsApp──► Bot Number ──► Your Homelab ──► Saving-<Year>.xlsx
```

---

## 🎯 Use Cases

| Scenario | How the Bot Helps |
|---|---|
| Daily expense logging | Log groceries, fuel, utility bills from your phone in seconds |
| Family budget visibility | All whitelisted members can view summaries and log entries |
| Petty cash tracking | Separate petty cash available / used / left from bank balance |
| Monthly reporting | Export interactive HTML reports with charts and date breakdowns |
| Year-end review | Full-year summary with month-wise savings and running balances |
| Scheduled backups | Auto-send Excel files to family WhatsApp at set times daily |

---

## ✨ Features

- **📅 Expense Entry** — Enter income/expenses by section → category → day, with existing values shown
- **🏦 Budget Management** — Update bank balance, petty cash, and starting balance
- **📊 Summary Views** — Month-wise and year-wise summaries with Bank / Petty Cash / Balance sections
- **📎 Excel Download** — Send the live `.xlsx` file directly to WhatsApp
- **🌐 HTML Reports** — Interactive reports with pie charts, date-pivot tables, and visual analysis
- **📋 Year Template** — Create a new `Saving-<Year>.xlsx` from template without leaving WhatsApp
- **🔄 Year Switching** — Switch active year on the fly; all files live in `Saving-Year/` folder
- **⏰ Scheduled Backups** — Auto-send Excel at 11:15 AM, 4:20 PM, 8:30 PM, 11:50 PM PKT
- **⏸ Backup Toggle** — Each user can stop/resume their own scheduled backups
- **🔒 Whitelist Only** — Completely silent to all non-authorised numbers
- **🔑 Dual Keywords** — `Sbot` (public) and a hidden keyword both open the menu

---

## 🛠 Prerequisites

### Software

| Requirement | Version | Notes |
|---|---|---|
| Docker | 20+ | `docker --version` |
| Docker Compose | v2+ | `docker compose version` |
| Git (optional) | Any | For cloning |

> Docker handles Node.js 20 and Chromium automatically — nothing else to install on the host.

### Hardware

| Component | Minimum | Recommended |
|---|---|---|
| CPU | 1 core | 2 cores |
| RAM | 512 MB free | 1 GB free |
| Storage | 500 MB | 2 GB (for session + Excel files) |
| Network | Always-on internet | Wired preferred |

Any of the following work perfectly:
- Raspberry Pi 4 (2 GB+)
- Mini PC (Intel N100, N5095 etc.)
- VPS (any provider)
- Old laptop running Ubuntu

### WhatsApp

- A **second SIM/number** for the bot (any network — Jazz, Zong, Telenor, etc.)
- WhatsApp installed on a phone with that SIM (for the first QR scan only)
- After scanning, the session is saved — the SIM phone can be put away

### Ports

| Port | Direction | Purpose |
|---|---|---|
| None required | Outbound only | WhatsApp uses HTTPS/WSS outbound |

No inbound ports need to be opened. The bot connects outbound to WhatsApp's servers.

---

## 📁 Folder Structure

```
Saving-Bot-v0.1/
├── bot.js               ← WhatsApp client + message routing
├── config.js            ← Whitelist, template path, year settings
├── handler.js           ← Conversation state machine
├── excel.js             ← Excel read/write + HTML report generation
├── scheduler.js         ← Scheduled backup cron jobs
├── package.json
├── docker-compose.yml
├── README.md
├── Template.xlsx        ← Blank year template (do not modify)
├── Saving-Year/
│   ├── Saving-2026.xlsx ← Active budget file
│   └── Saving-2027.xlsx ← Future year (created via bot)
├── session/             ← Auto-created: WhatsApp session data
└── bot_settings.json    ← Auto-created: active year + user preferences
```

---

## 🚀 Installation

### Step 1 — Copy files

```bash
mkdir ~/Saving-Bot-v0.1
cd ~/Saving-Bot-v0.1
# Place all bot files here
```

### Step 2 — Place your Excel file

```bash
mkdir -p Saving-Year
cp /path/to/Saving-2026.xlsx Saving-Year/Saving-2026.xlsx
cp /path/to/Template.xlsx .
```

### Step 3 — Configure (see [Configuration](#-configuration))

### Step 4 — Start

```bash
docker compose up -d
docker compose logs -f saving-bot-v0.1
```

On first start, a **QR code** appears in the logs. Scan it with the bot's WhatsApp number.

```
📱 Scan this QR code with the BOT WhatsApp number:

▄▄▄▄▄▄▄ ▄  ▄ ▄▄▄▄▄▄▄
█ ▄▄▄ █ ▄▀▄ █ ▄▄▄ █
...

Waiting for scan...
```

After scanning:
```
🔐 Authenticated successfully
⏰ Scheduled: 11:15 AM PKT
✅ Saving-Bot-v0.1 is LIVE!
💬 Send "Sbot" to start
```

---

## ⚙ Configuration

Open `config.js` and update the whitelist and notify numbers:

```js
// Who can use the bot (no + sign, no spaces)
const WHITELIST = [
    "923111794794",      // Your number (phone format)
    "161942429786177",   // Your number (LID format — see below)
    "923244198958",      // Family member
    "133977293766855",   // Family member (LID format)
];

// Numbers that receive scheduled file backups (phone format only)
const NOTIFY_NUMBERS = [
    "923111794794",
    "923244198958",
];
```

---

## 🔍 Adding WhatsApp Numbers to Whitelist

Modern WhatsApp uses two ID formats for the same number:

| Format | Example | When used |
|---|---|---|
| Phone format | `923111794794@c.us` | Standard messages |
| LID format | `161942429786177@lid` | Linked/multi-device accounts |

The bot may receive your message in either format. You need **both** in the whitelist to be safe.

### Step-by-step: Finding and adding a number

**Step 1 — Start the bot and have the person send any message**

```bash
docker compose logs -f saving-bot-v0.1
```

**Step 2 — Look for the resolved line in logs**

When someone messages the bot, the log shows:

```
🔍 Resolved 161942429786177@lid → 161942429786177
📨 from=161942429786177@lid resolved=161942429786177 body="hello"
🚫 Blocked: 161942429786177 (not in whitelist)
```

Or if they come through as phone format:

```
🔍 Resolved 923111794794@c.us → 923111794794
📨 from=923111794794@c.us resolved=923111794794 body="hello"
```

**Step 3 — Note both the `from=` value and the `resolved=` value**

| Log field | What to add to WHITELIST |
|---|---|
| `from=161942429786177@lid` | Add `"161942429786177"` |
| `from=923111794794@c.us` | Add `"923111794794"` |
| `resolved=161942429786177` | Add `"161942429786177"` (same as LID) |

**Step 4 — Edit `config.js`**

```js
const WHITELIST = [
    "923111794794",      // ← phone format (from @c.us log)
    "161942429786177",   // ← LID format   (from @lid log)
    // add more numbers here...
];
```

**Step 5 — Restart the bot**

```bash
docker compose restart saving-bot-v0.1
```

**Step 6 — Verify**

Have the person send `Sbot` — they should now see the main menu.

### Quick reference: reading the logs

```
saving-bot-v0.1 | 🔍 Resolved 161942429786177@lid → 161942429786177
                             ──────────────────────   ─────────────────
                             from= value              resolved= value
                             (add without @lid)       (add this too)
```

```
saving-bot-v0.1 | 📨 from=923111794794@c.us resolved=923111794794 body="Sbot"
                              ─────────────────                   ─────────────
                              Phone format ID                      Same digits
                              (add without @c.us)
```

### Example: Adding a new family member

1. They send `Sbot` to the bot number
2. Logs show:
   ```
   🔍 Resolved 188227495436364@lid → 188227495436364
   📨 from=188227495436364@lid resolved=188227495436364 body="Sbot"
   ```
3. Add to `config.js`:
   ```js
   const WHITELIST = [
       "923111794794",
       "161942429786177",
       "923244198958",
       "133977293766855",
       "188227495436364",   // ← new family member (LID)
   ];
   ```
4. If they also appear as `@c.us`, add that too:
   ```js
   "923331234567",      // ← new family member (phone)
   "188227495436364",   // ← new family member (LID)
   ```
5. `docker compose restart saving-bot-v0.1`

---

## 📊 Creating Your Year Excel File

### Option A — Via WhatsApp Bot (Recommended)

1. Send `Sbot` to the bot
2. Select `6 — Create New Year Template`
3. Enter the year (e.g. `2027`)
4. Confirm → bot sends `Saving-2027.xlsx` to your WhatsApp
5. The file is also saved to `Saving-Year/Saving-2027.xlsx` on your homelab
6. Select `7 — Switch Active Year` → enter `2027`

### Option B — Manually

```bash
cp Template.xlsx Saving-Year/Saving-2027.xlsx
```

Then open in Excel and:
1. In `Section-Category` sheet: change year cell (D1) from `2026` → `2027`
2. Update all date cells in rows 6–17 to the new year
3. In `Budget` sheet: update cell A1 to `Budget Manager v0.1`

### Excel Worksheet Overview

| Sheet | Purpose |
|---|---|
| `Section-Category` | Main daily entry sheet — all income/expense rows |
| `Budget` | Starting balance, petty cash allocation per month |
| Other sheets | Auto-calculated summaries (do not edit directly) |

**Row layout in Section-Category:**

```
Row 5–11    INCOME (Wages, Interest, Dividends, etc.)
Row 15–22   Petty Cash Used (Food, Donation, etc.)
Row 26–28   Savings Expense
Row 34–46   Home Expenses
Row 50–59   Daily Living
Row 63–70   Children
Row 74–79   Transportation
Row 83–87   Health
Row 91–94   Education
Row 98–101  Charity/Gifts
Row 105–108 Obligations
Row 119–129 Entertainment
Row 140–145 Subscriptions
Row 149–154 Vacation
Row 158–160 Miscellaneous
Row 164     Total Per Day (auto-calculated, excludes Income & Petty Cash)
```

---

## 🔑 Bot Keywords

| Keyword | Visible to users | Action |
|---|---|---|
| `Sbot` | ✅ Yes — shown in all prompts | Opens main menu |
| `Gofy` | ❌ No — never shown | Opens main menu (hidden) |
| `Reset` | ✅ Yes | Resets session |
| `help` | ✅ Yes | Shows command list |
| `cancel` / `exit` | ✅ Yes | Ends session |
| `back` or `0` | ✅ Yes | Go one step back |
| `stop schedule` | ✅ Yes | Stop your scheduled backups |
| `start schedule` | ✅ Yes | Resume scheduled backups |
| `?N` | ✅ Yes | Preview section N categories |

---

## 📱 WhatsApp Conversation Flow

### 🔹 Opening the Bot

<table>
<tr>
<td width="45%">

```
┌─────────────────────────────┐
│  📱 WhatsApp                │
├─────────────────────────────┤
│                             │
│  You:  Sbot                 │
│                             │
│  ╔═══════════════════════╗  │
│  ║ 🤖 Gofy Assistant     ║  │
│  ║ Active Year: *2026*   ║  │
│  ║ ═══════════════════   ║  │
│  ║                       ║  │
│  ║ 📅 1  Enter Expense   ║  │
│  ║ 🏦 2  Update Budget   ║  │
│  ║ 📊 3  View Summary    ║  │
│  ║ 📎 4  Download Excel  ║  │
│  ║ 🌐 5  HTML Report     ║  │
│  ║ 📋 6  New Year File   ║  │
│  ║ 🔄 7  Switch Year     ║  │
│  ║ ⏸  8  Stop Backups    ║  │
│  ║ ───────────────────   ║  │
│  ║ Reply with a number   ║  │
│  ╚═══════════════════════╝  │
│                             │
└─────────────────────────────┘
```

</td>
<td width="55%" valign="top">

**Main Menu** shows the active year at the top so you always know which file you're working in. Eight options cover every use case.

Type `Sbot` to open the menu. There is also a hidden keyword that works the same way.

Option 8 dynamically shows **Stop** or **Resume** based on your current backup preference — each person controls their own.

Send `0` or `back` at any step to go one level up.

</td>
</tr>
</table>

---

### 🔹 Entering an Expense

<table>
<tr>
<td width="45%">

```
┌─────────────────────────────┐
│  📱 WhatsApp                │
├─────────────────────────────┤
│  You:  1 → May → 4          │
│                             │
│  ╔═══════════════════════╗  │
│  ║ 📋 May 2026 ›         ║  │
│  ║    HOME EXPENSES      ║  │
│  ║ Monthly totals shown  ║  │
│  ║ ───────────────────   ║  │
│  ║  1  Mortgage/Rent  —  ║  │
│  ║  2  Electricity 8,500 ║  │
│  ║  3  Gas/Oil        —  ║  │
│  ║  4  Phone       3,200 ║  │
│  ║  ...                  ║  │
│  ║  0  ⬅ Back            ║  │
│  ╚═══════════════════════╝  │
│                             │
│  You:  2  (Electricity)     │
│                             │
│  ╔═══════════════════════╗  │
│  ║ 📆 May 2026 ›         ║  │
│  ║    HOME EXPENSES ›    ║  │
│  ║    Electricity        ║  │
│  ║ ───────────────────   ║  │
│  ║ Filled days:          ║  │
│  ║  📅 Day 01 → 8,500   ║  │
│  ║ ───────────────────   ║  │
│  ║ Enter day (1–31):     ║  │
│  ║  0  ⬅ Back            ║  │
│  ╚═══════════════════════╝  │
└─────────────────────────────┘
```

</td>
<td width="55%" valign="top">

**Section view** shows the monthly total for every category so you instantly see what's already been entered. Categories with no entries show `—`.

**Preview categories** before selecting a section by typing `?N` (e.g. `?4` shows all HOME EXPENSES categories without navigating into it).

**Day selection** shows all previously filled days with their values — you can update an existing entry or add a new one. No guessing what's already been entered.

The breadcrumb trail at the top (`May 2026 › HOME EXPENSES › Electricity`) keeps you oriented at every step.

</td>
</tr>
</table>

---

### 🔹 Viewing a Summary

<table>
<tr>
<td width="45%">

```
┌─────────────────────────────┐
│  📱 WhatsApp                │
├─────────────────────────────┤
│  You:  3 → 1 → May          │
│                             │
│  ╔═══════════════════════╗  │
│  ║ 📊 May 2026 — Summary ║  │
│  ║ ═══════════════════   ║  │
│  ║                       ║  │
│  ║ 🏦 Bank               ║  │
│  ║ ─────────────────     ║  │
│  ║  Income    414,218    ║  │
│  ║  Expenses  140,719    ║  │
│  ║  Net      +273,499    ║  │
│  ║                       ║  │
│  ║ 💵 Petty Cash         ║  │
│  ║ ─────────────────     ║  │
│  ║  Available  22,500    ║  │
│  ║  Used            0    ║  │
│  ║  Left       22,500    ║  │
│  ║                       ║  │
│  ║ ⚖️ Balance             ║  │
│  ║ ─────────────────     ║  │
│  ║  Bank    2,049,840    ║  │
│  ║  Petty+B 2,072,340    ║  │
│  ╚═══════════════════════╝  │
└─────────────────────────────┘
```

</td>
<td width="55%" valign="top">

**Summary view** is divided into three clear sections matching your Excel structure:

🏦 **Bank** shows your income, expenses (bank transactions only — petty cash excluded), and net for the month.

💵 **Petty Cash** shows your allocated cash, how much has been spent from it, and how much remains in hand.

⚖️ **Balance** shows your running bank balance (starting balance + cumulative net across all previous months) and total savings including petty cash on hand.

All balances are **computed fresh** from raw cell data — not from Excel's stale formula cache, so they're always accurate.

</td>
</tr>
</table>

---

### 🔹 Year Summary

<table>
<tr>
<td width="45%">

```
┌─────────────────────────────┐
│  📱 WhatsApp                │
├─────────────────────────────┤
│  ╔═══════════════════════╗  │
│  ║ 📊 2026 Year Summary  ║  │
│  ║ ═══════════════════   ║  │
│  ║ 🏦 Bank               ║  │
│  ║  Income  1,200,000    ║  │
│  ║  Expenses  780,000    ║  │
│  ║  Net      +420,000    ║  │
│  ║                       ║  │
│  ║ ⚖️ Balance             ║  │
│  ║  Initial 1,776,341    ║  │
│  ║  Bank    2,196,341    ║  │
│  ║  Petty+B 2,218,841    ║  │
│  ║                       ║  │
│  ║ 📅 Month-wise Saving  ║  │
│  ║ ─────────────────     ║  │
│  ║ *Jan*                 ║  │
│  ║  Net:     +23,659     ║  │
│  ║  PC Left:  22,500     ║  │
│  ║  Total:   +46,159     ║  │
│  ║                       ║  │
│  ║ *May*                 ║  │
│  ║  Net:    +273,499     ║  │
│  ║  PC Left:  22,500     ║  │
│  ║  Total:  +295,999     ║  │
│  ╚═══════════════════════╝  │
└─────────────────────────────┘
```

</td>
<td width="55%" valign="top">

**Year summary** shows cumulative totals across all months.

The **Balance** section includes the Initial Balance (year-start amount) so you can trace the full picture from where you started to where you are now.

**Month-wise Saving** shows each active month as a block:
- **Net** — income minus expenses for the month
- **PC Left** — petty cash remaining after spending  
- **Total** — true monthly saving = Net + PC Left

Only months with non-zero activity are shown — empty months are hidden.

</td>
</tr>
</table>

---

## 🌐 HTML Reports

Send `Sbot` → `5 — HTML Report` → choose month or full year. The bot sends an `.html` file — open it in your phone's browser.

### Month Report Layout

```
┌─────────────────────────────────────────────┐
│  💰 May 2026 Report                          │
├──────────────┬──────────────┬───────────────┤
│ 💵 Petty Cash│ 🏦 Bank      │ ⚖️ Balance     │
│ Available    │ Income       │ Bank          │
│ Used         │ Expenses     │ Petty+Bank    │
│ Left         │ Net          │               │
├─────────────────────────────────────────────┤
│ [📂 Sections]  [📊 Section Breakdown]        │
├─────────────────────────────────────────────┤
│  Scrollable category tabs per section       │
│                                             │
│  📊 Visual Analysis                         │
│  ┌───────────┐   ┌───────────┐             │
│  │  Expense  │   │  Income   │             │
│  │  Pie Chart│   │  Pie Chart│             │
│  │  by sect. │   │  by sect. │             │
│  └───────────┘   └───────────┘             │
└─────────────────────────────────────────────┘
```

### Section Breakdown Tab

```
┌──────────────────────────────────────────────────┐
│  📅 Total Per Day  (expense sections only)        │
│  Date  │ 01/05 │ 02/05 │ 15/05 │ Grand Total    │
│  Total │ 132K  │  8.5K │  45K  │    185K        │
├──────────────────────────────────────────────────┤
│  HOME EXPENSES (only dates with data shown)      │
│  Category       │ 01/05 │ 15/05 │ Total          │
│  Electricity    │  —    │ 8,500 │  8,500         │
│  Internet       │ 3,200 │  —    │  3,200         │
│  Total          │ 3,200 │ 8,500 │ 11,700         │
├──────────────────────────────────────────────────┤
│  📊 Visual Analysis — Category Breakdown         │
│  One pie chart per section showing % per cat.    │
└──────────────────────────────────────────────────┘
```

### Year Report

The year report has **month tabs** (Jan → Dec). Each month tab has the same two-tab layout (Sections + Section Breakdown + Visual Analysis), plus year-level totals and Initial Balance at the top.

---

## ⏰ Scheduled Backups

The bot automatically sends all `.xlsx` files in `Saving-Year/` to `NOTIFY_NUMBERS` at:

| Time (PKT) | Cron |
|---|---|
| 11:15 AM | `15 11 * * *` |
| 4:20 PM | `20 16 * * *` |
| 8:30 PM | `30 20 * * *` |
| 11:50 PM | `50 23 * * *` |

**To stop your backups:** Send `stop schedule` or select **Option 8** in the main menu.  
**To resume:** Send `start schedule` or select **Option 8** again.

Each family member controls their own backup preference independently — stopping for one does not affect others.

---

## 🔧 Troubleshooting

| Problem | Fix |
|---|---|
| QR code expired | `docker compose restart saving-bot-v0.1` |
| Bot not responding to `Sbot` | Check both phone format AND LID are in `WHITELIST` — see [Adding Numbers](#-adding-whatsapp-numbers-to-whitelist) |
| Chromium lock error | `rm -f session/session/SingletonLock && docker compose restart saving-bot-v0.1` |
| Session lost after restart | `rm -rf session/ && docker compose restart saving-bot-v0.1` (rescan QR) |
| `[object Object]` in report | Formula cell with no cached result — bot now computes these fresh automatically |
| Petty Cash Left shows 0 | Check `pettyCashAvailable` is set in Budget sheet row 11 for at least one month |
| Excel styling lost | Uses ExcelJS which fully preserves all cell styles on write |
| `node-cron not found` | `docker compose down && docker compose up -d` (triggers full npm reinstall) |
| `@lid` blocked messages on startup | Normal — WhatsApp internal sync messages, safely ignored |
| Wrong balance in report | Running balance computed from raw entries — check Budget sheet row 3 (Starting Balance) |

### Useful Commands

```bash
# View live logs
docker compose logs -f saving-bot-v0.1

# Restart bot (keeps session)
docker compose restart saving-bot-v0.1

# Stop everything
docker compose down

# Full rebuild (reinstalls npm packages)
docker compose down && docker compose up -d

# Check running containers
docker compose ps

# Remove stale Chromium lock (if bot won't start)
rm -f session/session/SingletonLock
rm -f session/session/SingletonCookie
docker compose restart saving-bot-v0.1
```

---

## 🔒 Security

- Only `WHITELIST` numbers receive any response — all others are completely silent (no reply, no log)
- Session data stored locally in `./session/` — never uploaded anywhere
- Excel file stays on your homelab — never sent to any external service
- No inbound ports required — bot connects outbound only
- `bot_settings.json` stores only active year and per-user backup preferences

---

## 📄 License

Private homelab project. Not for redistribution.

---

<div align="center">

Built with ❤️ for family budget management · Saving-Bot-v0.1

</div>