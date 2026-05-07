'use strict';

const cron          = require('node-cron');
const fs            = require('fs');
const path          = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { NOTIFY_NUMBERS, YEAR_FOLDER } = require('./config');
const mailer = require('./mailer');
const { getDayReport } = require('./excel');

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ── Scheduled times (PKT = Asia/Karachi = UTC+5) ─────────────────────────────
const SCHEDULES = [
    { cron: '15 11 * * *', label: '11:15 AM' },
    { cron: '20 16 * * *', label: '04:20 PM' },
    { cron: '30 20 * * *', label: '08:30 PM' },
    { cron: '50 23 * * *', label: '11:50 PM' },
];

async function sendDailyFiles(client) {
    if (!client.info) {
        console.log('⏰ Scheduler: client not ready, skipping.');
        return;
    }

    // Collect all xlsx files in Saving-Year/
    let files = [];
    try {
        files = fs.readdirSync(YEAR_FOLDER).filter(f => f.endsWith('.xlsx'));
    } catch (e) {
        console.error('⏰ Scheduler: cannot read YEAR_FOLDER:', e.message);
        return;
    }

    if (files.length === 0) {
        console.log('⏰ Scheduler: no xlsx files found in Saving-Year/');
        return;
    }

    const now = new Date().toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi' });
    console.log(`⏰ Scheduler: sending ${files.length} file(s) to ${NOTIFY_NUMBERS.length} number(s) at ${now}`);

    for (const number of NOTIFY_NUMBERS) {
        const chatId = `${number}@c.us`;
        for (const file of files) {
            try {
                const filePath = path.join(YEAR_FOLDER, file);
                const media    = MessageMedia.fromFilePath(filePath);
                await client.sendMessage(chatId, media, {
                    caption: `📊 *${file}*\n_Scheduled backup — ${now} PKT_`
                });
                console.log(`📤 Sent ${file} → ${number}`);
            } catch (err) {
                console.error(`❌ Failed to send ${file} → ${number}:`, err.message);
            }
        }
    }
}

// ── Day-end email report ─────────────────────────────────────────────────────
async function sendDayEndEmailReport() {
    try {
        const now   = new Date();
        const month = MONTHS[now.getMonth()];
        const day   = now.getDate();
        console.log(`📧 Day-end report: generating for ${month} day ${day}...`);
        const report = await getDayReport(month, day);
        await mailer.sendDayEndReport(report);
    } catch (err) {
        console.error('📧 Day-end report error:', err.message);
    }
}

function startScheduler(client) {
    for (const { cron: expr, label } of SCHEDULES) {
        cron.schedule(expr, () => {
            console.log(`⏰ Scheduler triggered: ${label} PKT`);
            sendDailyFiles(client).catch(err =>
                console.error('⏰ Scheduler error:', err.message)
            );
            // Send day-end email report on the last schedule of the day (11:50 PM)
            if (expr === '50 23 * * *') {
                sendDayEndEmailReport();
            }
        }, { timezone: 'Asia/Karachi' });

        console.log(`⏰ Scheduled: ${label} PKT (${expr})`);
    }
}

module.exports = { startScheduler };