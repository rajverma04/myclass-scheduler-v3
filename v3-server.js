/**
 * AutoClassJoiner - Pro Version V3
 * Features: Morning briefing + 5min Joining Verification with Screenshots
 */

require('dotenv').config();
const express = require('express');
const schedule = require('node-schedule');
const path = require('path');
const AutoClassBot = require('./bot');

const app = express();
const bot = new AutoClassBot();
const PORT = process.env.PORT || 3000;

// Credentials from environment variables
let credentials = {
  regNumber: process.env.REG_NUMBER || '',
  password: process.env.PASSWORD || ''
};

let botEnabled = true;
let activeTimers = [];

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Perform Morning Sync and Email Briefing
 */
async function morningSync() {
  if (!credentials.regNumber || !credentials.password) {
    bot.log('Morning Sync skipped: No credentials.', 'warn');
    return;
  }

  bot.log('🌅 Morning Sync: Scraping today\'s schedule and sending briefing...');

  // Force a fresh scrape
  const result = await bot.checkAndJoin(credentials.regNumber, credentials.password, true);

  // Send the email summary (Whether there are classes or not)
  await bot.sendScheduleEmail(bot.dailyTimetable);

  // If classes were found, schedule the individual joins
  if (bot.dailyTimetable.length > 0) {
    setupClassTimers(bot.dailyTimetable);
  } else {
    bot.log('🛌 No classes today. Bot will stay in sleep mode.');
  }
}

/**
 * Schedule precise join and verification events
 */
function setupClassTimers(timetable) {
  // Clear any existing timers
  activeTimers.forEach(t => t.cancel());
  activeTimers = [];

  const now = Date.now();

  timetable.forEach(c => {
    // Parse the start time (IST interpretation)
    const startTime = bot.parseSingleTime(c.time.split(/[-]|to/i)[0]);
    if (!startTime) return;

    // Trigger Join exactly at start time (or 1 min before)
    const joinTriggerTime = new Date(startTime - 60000);

    if (joinTriggerTime > now) {
      bot.log(`📅 Scheduled join for "${c.name}" at ${joinTriggerTime.toLocaleTimeString('en-IN')}`);

      const job = schedule.scheduleJob(joinTriggerTime, async () => {
        bot.log(`🚀 Triggering Join for "${c.name}"...`);

        // 1. Join the class
        const joined = await bot.checkAndJoin(credentials.regNumber, credentials.password, true);

        if (joined.joined) {
          bot.log(`⏳ Class joined. Waiting 5 minutes for verification screenshot...`);

          // 2. Wait 5 minutes
          setTimeout(async () => {
            bot.log(`📸 Taking verification screenshot for "${c.name}"...`);

            // Ensure we are still in the browser session
            if (bot.page && !bot.page.isClosed()) {
              const screenshot = await bot.page.screenshot({ type: 'jpeg', quality: 50 });

              // 3. Send the email WITH proof
              await bot.sendNotificationEmail(c.name, c.time, 'VERIFIED', screenshot);
              bot.log(`✅ Verification email sent with screenshot.`);
            } else {
              bot.log(`❌ Failed to take screenshot: Browser session closed.`, 'error');
            }
          }, 5 * 60 * 1000); // 5 minutes delay
        }
      });

      activeTimers.push(job);
    }
  });

  bot.log(`✅ Smart Scheduler (V3): ${activeTimers.length} verification events active.`);
}

// ========== API Routes (Dashboard Support) ==========

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/status', (req, res) => {
  const status = bot.getStatus();
  res.json({
    ...status,
    botEnabled,
    hasCredentials: !!(credentials.regNumber && credentials.password),
    regNumber: credentials.regNumber,
    activeTimers: activeTimers.length,
    v3: true
  });
});

app.post('/api/trigger', async (req, res) => {
  if (!credentials.regNumber || !credentials.password) {
    return res.status(400).json({ error: 'No credentials set.' });
  }
  bot.log('⚡ Manual full sync triggered from dashboard...');
  await morningSync();
  res.json({ success: true, message: 'Sync complete and V3 timers updated.' });
});

// Send Test Email
app.post('/api/test-email', async (req, res) => {
  bot.log('🧪 Sending a test email...');
  try {
    await bot.sendNotificationEmail('Test Class', '12:00 PM', 'TEST');
    res.json({ success: true, message: 'Test email sent. Check your inbox.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== Cron Schedulers ==========

// 1. Morning Sync (Every day at 8:00 AM IST)
schedule.scheduleJob({ hour: 11, minute: 0, tz: 'Asia/Kolkata' }, () => {
  morningSync();
});

// 2. Afternoon Safety Sync (2:00 PM IST)
schedule.scheduleJob({ hour: 17, minute: 0, tz: 'Asia/Kolkata' }, () => {
  morningSync();
});

// 3. Keep-Alive Ping (Every 14 mins)
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(async () => {
    try { await fetch(`${RENDER_URL}/health`); } catch { }
  }, 14 * 60 * 1000);
}

app.get('/health', (req, res) => res.json({ status: 'ok', version: 'v3-pro' }));

// ========== Start Server ==========

app.listen(PORT, () => {
  console.log(`\n🚀 AutoClassJoiner V3 (Verified) running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}\n`);

  bot.log('V3 Pro Server started. Initializing morning sync...');

  if (credentials.regNumber && credentials.password) {
    morningSync();
  }
});
