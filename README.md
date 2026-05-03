# 💰 SavingHomeLab WhatsApp Bot (Free Version)

100% free — no Twilio, no API keys, no monthly fees.
Uses your own WhatsApp number (second SIM) via whatsapp-web.js.

---

## 📋 What You Need

| Requirement | Details |
|------------|---------|
| Second SIM/number | Any Jazz/Zong/Telenor SIM — for the bot |
| Docker | Already on your homelab ✅ |
| Always-on machine | Any of your Mini PCs ✅ |
| Saving-2026.xlsx | Place in this folder ✅ |

---

## ⚙️ Step 1 — Configure

Open `config.js` and set your two phone numbers:

```js
const WHITELIST = [
    "923001234567",   // YOUR number (with country code, no + or spaces)
    "923211234567",   // Second contact's number
];
```

Format: `92` (Pakistan) + number without leading zero
Example: `0300-1234567` → `923001234567`

---

## 🚀 Step 2 — Start the Bot

```bash
# Place your Excel file in this folder first
cp /path/to/Saving-2026.xlsx .

# Start the bot
docker compose up
```

The first time it runs, it will print a **QR code** in the terminal.

---

## 📱 Step 3 — Scan QR Code

1. Insert the **bot's SIM** into a phone (or use an old phone)
2. Open WhatsApp on that phone
3. Go to **Settings → Linked Devices → Link a Device**
4. Scan the QR code shown in the terminal
5. Done! The session is saved — you won't need to scan again

---

## 💬 Step 4 — Use the Bot

From YOUR WhatsApp, message the bot's number:

```
savinghomelab
```

You'll get the main menu. Only your 2 whitelisted numbers can use it.

---

## 🔄 Conversation Flow

```
You → savinghomelab
Bot → Main menu: 1) Monthly entry  2) Budget  3) Summary

You → 1
Bot → Select month (1-12)

You → 5        (May)
Bot → Select section (1-15)

You → 4        (HOME EXPENSES)
Bot → Select category (1-13)

You → 2        (Electricity)
Bot → Enter day (1-31)

You → 15
Bot → Current: 0. Enter new amount:

You → 8500
Bot → Confirm? 1=Yes 2=Change 3=Cancel

You → 1
Bot → ✅ Saved!
```

---

## 📁 Files

```
saving_bot_free/
├── bot.js              ← WhatsApp client + QR code
├── handler.js          ← Conversation logic
├── excel.js            ← Excel read/write
├── config.js           ← ⚠️ EDIT THIS — set your numbers
├── package.json
├── docker-compose.yml
├── Saving-2026.xlsx    ← Your spreadsheet
└── session/            ← Auto-created, stores WhatsApp login
```

---

## 🔒 Security

- Only the 2 numbers in `WHITELIST` can trigger any response
- All other messages are silently ignored
- Session stored locally in `./session/` folder
- No data ever leaves your homelab

---

## 🛠️ Commands

| Command | Action |
|---------|--------|
| `savinghomelab` | Start the bot |
| `cancel` / `exit` | Abort current session |
| `help` | Show help |

---

## 🔧 Troubleshooting

| Problem | Fix |
|---------|-----|
| QR code expired | Restart container: `docker compose restart` |
| Bot not responding | Check if your number is in WHITELIST (no + sign) |
| Session lost after restart | Check `./session/` folder exists and has files |
| Chromium error | Run `docker compose up --build` to reinstall |
| Excel not updating | Make sure `Saving-2026.xlsx` is in the bot folder |

---

## 📌 Run in Background

```bash
# Start in background
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```
