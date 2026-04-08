/**
 * AutoClassJoiner - Smart Server V2
 * Features: Morning Briefing Email + Dynamic Class Scheduling
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
  await bot.checkAndJoin(credentials.regNumber, credentials.password, true);

  // Send the email summary
  if (bot.dailyTimetable.length >= 0) {
    await bot.sendScheduleEmail(bot.dailyTimetable);
    // Schedule the individual joins
    setupClassTimers(bot.dailyTimetable);
  }
}

/**
 * Schedule precise join events for each class
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

    // Schedule 2 minutes before the actual start time
    const joinTriggerTime = new Date(startTime - 2 * 60000);

    if (joinTriggerTime > now) {
      bot.log(`📅 Scheduled join for "${c.name}" at ${joinTriggerTime.toLocaleTimeString('en-IN')}`);

      const job = schedule.scheduleJob(joinTriggerTime, async () => {
        bot.log(`🚀 Precision Trigger: Time to join "${c.name}"`);
        await bot.checkAndJoin(credentials.regNumber, credentials.password, true);
      });

      activeTimers.push(job);
    } else if (startTime > now) {
      // If we missed the "2 mins before" but class hasn't started yet, join NOW
      bot.log(`🚀 Immediate Join: Class "${c.name}" starts very soon.`);
      bot.checkAndJoin(credentials.regNumber, credentials.password, true);
    }
  });

  bot.log(`✅ Smart Scheduler: ${activeTimers.length} join events active for today.`);
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
    v2: true
  });
});

app.post('/api/trigger', async (req, res) => {
  if (!credentials.regNumber || !credentials.password) {
    return res.status(400).json({ error: 'No credentials set.' });
  }
  bot.log('⚡ Manual full sync triggered from dashboard...');
  await morningSync();
  res.json({ success: true, message: 'Sync complete and timers updated.' });
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

// 1. Morning Sync (Set to 1:47 AM for your test)
schedule.scheduleJob({ hour: 1, minute: 47, tz: 'Asia/Kolkata' }, () => {
  morningSync();
});

// 2. Afternoon Safety Sync (Every day at 2:00 PM IST)
schedule.scheduleJob({ hour: 14, minute: 0, tz: 'Asia/Kolkata' }, () => {
  bot.log('🔄 Mid-day safety sync...');
  morningSync();
});

// 3. Keep-Alive Ping (Every 14 mins)
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
  setInterval(async () => {
    try { await fetch(`${RENDER_URL}/health`); } catch { }
  }, 14 * 60 * 1000);
}

app.get('/health', (req, res) => res.json({ status: 'ok', version: 'v2-smart' }));

// ========== Start Server ==========

app.listen(PORT, () => {
  console.log(`\n🚀 AutoClassJoiner V2 (Smart Scheduler) running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}\n`);

  bot.log('V2 Server started. Initializing smart sync...');

  // Perform initial sync on startup
  if (credentials.regNumber && credentials.password) {
    morningSync();
  }
});
