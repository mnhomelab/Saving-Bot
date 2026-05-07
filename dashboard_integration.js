// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD INTEGRATION SNIPPET
// Add these pieces to your index.js (or whichever file handles messages)
// ─────────────────────────────────────────────────────────────────────────────


// ── 1. Import at the top of index.js ─────────────────────────────────────────
const dashboard = require('./dashboard');


// ── 2. On bot start — call these once the client is ready ────────────────────
//    (place inside your client 'ready' or 'open' event handler)

dashboard.setBotOnline(true);
dashboard.setWhitelist(process.env.WHITELIST.split(',').map(n => n.trim()));
dashboard.setSchedules([
    { label: '11:15 AM PKT', cron: '15 11 * * *' },
    { label: '04:20 PM PKT', cron: '20 16 * * *' },
    { label: '08:30 PM PKT', cron: '30 20 * * *' },
    { label: '11:50 PM PKT', cron: '50 23 * * *' },
]);
// Auto-start dashboard when bot starts (remove if you prefer manual start)
dashboard.startDashboard();


// ── 3. Log every incoming message (add near top of your message handler) ─────
//    Replace 'msg.from' and 'msg.body' with your actual field names

dashboard.logActivity(msg.from, msg.body, 'in');


// ── 4. Log outgoing replies (add wherever you call msg.reply / client.sendMessage)
dashboard.logActivity(msg.from, replyText, 'out');


// ── 5. Dashboard menu handler ─────────────────────────────────────────────────
//    Add this inside your main message switch/if-else, as a new top-level command

if (body === '📊 dashboard' || body === 'dashboard') {
    await msg.reply(
`📊 *Monitoring Dashboard*

What would you like to do?

1️⃣ *Preview* — Get a secure link to open the live dashboard
2️⃣ *Start* — Start the dashboard server
3️⃣ *Stop* — Stop the dashboard server

Reply with *1*, *2*, or *3*`
    );
    // Store state so next message is handled as dashboard submenu
    userState[msg.from] = { menu: 'dashboard' };
    return;
}

// Dashboard submenu handler — put this BEFORE your main command checks
if (userState[msg.from]?.menu === 'dashboard') {
    delete userState[msg.from];   // clear state

    if (body === '1' || body === 'preview') {
        if (!dashboard.isRunning()) dashboard.startDashboard();
        const link = dashboard.generateToken(msg.from);
        await msg.reply(
`🔗 *Your private dashboard link:*

${link}

⏳ Link expires in *1 hour*
🔒 One-time use — only you can open it
📊 Live updates every few seconds`
        );
        return;
    }

    if (body === '2' || body === 'start') {
        const res = dashboard.startDashboard();
        await msg.reply(res.ok
            ? `✅ Dashboard started!\n\nSend *1* or *Preview* to get your access link.`
            : `⚠️ ${res.msg}`
        );
        return;
    }

    if (body === '3' || body === 'stop') {
        const res = dashboard.stopDashboard();
        await msg.reply(res.ok ? `🛑 ${res.msg}` : `⚠️ ${res.msg}`);
        return;
    }

    await msg.reply('❓ Invalid option. Send *dashboard* to try again.');
    return;
}


// ── 6. Update month summary whenever data changes (optional but recommended) ──
//    Call this after any write operation or on the scheduled backup jobs

const { getMonthSummary } = require('./excel');
const currentMonth = new Date().toLocaleString('en-PK', { month: 'long' });
getMonthSummary(currentMonth).then(summary => {
    dashboard.setMonthSummary({ ...summary, month: currentMonth });
}).catch(() => {});


// ── 7. Add to .env ────────────────────────────────────────────────────────────
//
//    DASHBOARD_PORT=3001
//    DASHBOARD_HOST=http://YOUR_SERVER_IP:3001
//
//    Replace YOUR_SERVER_IP with your Hetzner server's public IP.
//    Make sure port 3001 is open in your firewall:
//      ufw allow 3001/tcp


// ── 8. Add to your main menu text (wherever you list bot options) ─────────────
//    Add this line to your help/menu message:
//
//    📊 *Dashboard* — Live monitoring dashboard
