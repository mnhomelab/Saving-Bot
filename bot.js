'use strict';

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { handleMessage } = require('./handler');
const { startScheduler } = require('./scheduler');
const { WHITELIST } = require('./config');
const dashboard = require('./dashboard');

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './session' }),
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
});

// ── QR Code ───────────────────────────────────────────────────────────────────
client.on('qr', (qr) => {
    console.log('\n📱 Scan this QR code with the BOT WhatsApp number:\n');
    qrcode.generate(qr, { small: true });
    console.log('\nWaiting for scan...\n');
});

// ── Ready ─────────────────────────────────────────────────────────────────────
client.on('ready', () => {
    startScheduler(client);
    dashboard.setBotOnline(true);
    dashboard.setWhitelist(WHITELIST);
    dashboard.setSchedules([
        { label: '11:15 AM PKT', cron: '15 11 * * *' },
        { label: '04:20 PM PKT', cron: '20 16 * * *' },
        { label: '08:30 PM PKT', cron: '30 20 * * *' },
        { label: '11:50 PM PKT', cron: '50 23 * * *' },
    ]);
    dashboard.startDashboard();
    console.log('✅ Saving-Bot-v0.1 is LIVE!');
    console.log(`🔒 Whitelist: ${WHITELIST.join(', ')}`);
    console.log('💬 Send "Gofy" to start\n');
});

// ── Resolve real phone number from message ────────────────────────────────────
async function getRealNumber(msg) {
    try {
        const contact = await msg.getContact();
        if (contact && contact.number) {
            console.log(`🔍 Resolved ${msg.from} → ${contact.number}`);
            return contact.number;
        }
    } catch (e) {
        console.log(`⚠️  Could not resolve contact: ${e.message}`);
    }
    return msg.from.replace(/@.*$/, '');
}

// ── Main message processor ────────────────────────────────────────────────────
async function processMessage(msg) {
    const from = msg.from || '';
    const body = (msg.body || '').trim();

    // Skip groups and empty messages silently
    if (from.endsWith('@g.us')) return;
    if (!body) return;

    const number = await getRealNumber(msg);

    // Non-whitelisted: complete silence — no reply, no log
    // Bot appears as a normal inactive number to them
    if (!WHITELIST.includes(number)) return;

    console.log(`📩 [${number}] ${body}`);
    dashboard.logActivity(number, body, 'in');

    try {
        const reply = await handleMessage(number, body);
        if (reply) {
            if (typeof reply === 'object' && reply.type === 'file') {
                const media = MessageMedia.fromFilePath(reply.path);
                await client.sendMessage(msg.from, media, { caption: reply.caption || '' });
                console.log(`📎 [${number}] Sent file: ${reply.path}`);
                dashboard.logActivity(number, reply.caption || `File: ${reply.path}`, 'out');
            } else {
                await msg.reply(reply);
                console.log(`📤 [${number}] ${reply.substring(0, 80)}`);
                dashboard.logActivity(number, reply, 'out');
            }
        }
    } catch (err) {
        console.error('❌ Error handling message:', err);
        await msg.reply('❌ An error occurred. Please try again.\nSend *Gofy* to restart.');
    }
}

// ── Events ────────────────────────────────────────────────────────────────────
client.on('message', async (msg) => {
    if (msg.fromMe) return;
    await processMessage(msg);
});

client.on('authenticated', () => console.log('🔐 Authenticated successfully'));
client.on('auth_failure', (msg) => console.error('❌ Auth failed:', msg));
client.on('disconnected', (reason) => console.log('🔌 Disconnected:', reason));

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('🦀 Starting Saving-Bot-v0.1...');
client.initialize();