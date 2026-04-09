require('dotenv').config();
const express = require('express');
const schedule = require('node-schedule');
const path = require('path');
const AutoClassBot = require('./src/bot/AutoClassBot');

const app = express();
const bot = new AutoClassBot();
const PORT = process.env.PORT || 3000;

// Credentials from environment variables
const getCredentials = () => ({
  regNumber: process.env.REG_NUMBER || '',
  password: process.env.PASSWORD || ''
});

let credentials = getCredentials();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let botEnabled = true;

/**
 * Daily Sync Logic
 * @param {boolean} shouldEmail - Whether to send the daily briefing email
 */
async function syncSchedule(shouldEmail = true) {
  if (!botEnabled || !credentials.regNumber || !credentials.password) return;
  bot.log(`🌅 Syncing today's schedule (Email: ${shouldEmail ? 'ON' : 'OFF'})...`);
  try {
    const result = await bot.checkAndJoin(credentials.regNumber, credentials.password, true);
    
    // Only send email if requested (not on server startup)
    if (shouldEmail && bot.dailyTimetable.length > 0) {
      try {
        await bot.emailService.sendDailyBriefing(bot.dailyTimetable);
      } catch (err) {
        bot.log(`⚠️ Briefing email skipped due to connection issue, but schedule is loaded.`, 'warn');
      }
    }
    
    if (bot.dailyTimetable.length > 0) setupClassTimers(bot.dailyTimetable);
  } catch (e) {
    bot.log(`❌ Sync Failed: ${e.message}`, 'error');
  }
}

/**
 * Precision Join Scheduler
 */
function setupClassTimers(timetable) {
  timetable.forEach(c => {
    const startTime = bot.scraperService.parseSingleTime(c.time.split(/[-]|to/i)[0]);
    if (!startTime || startTime < Date.now()) return;

    const joinTriggerTime = new Date(startTime - 60000); // 1 min before
    schedule.scheduleJob(joinTriggerTime, async () => {
      if (!botEnabled) return;
      bot.log(`🚀 Automated Join for "${c.name}" triggered.`);
      await bot.checkAndJoin(credentials.regNumber, credentials.password, false);

      // Verification Screenshot (5 mins later)
      setTimeout(async () => {
        if (bot.browserService.page && !bot.browserService.page.isClosed()) {
          const buf = await bot.browserService.takeScreenshot();
          await bot.emailService.sendNotification(c.name, c.time, 'VERIFIED', buf);
        }
      }, 5 * 60 * 1000);
    });
  });
}

// ========== DASHBOARD API ==========

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/status', (req, res) => {
  const status = bot.getStatus();
  const currentCreds = getCredentials();
  res.json({
    ...status,
    botEnabled,
    hasCredentials: !!(currentCreds.regNumber && currentCreds.password),
    regNumber: currentCreds.regNumber
  });
});

app.post('/api/toggle', (req, res) => {
  botEnabled = !botEnabled;
  bot.log(`Bot ${botEnabled ? 'ENABLED' : 'PAUSED'} via dashboard.`);
  res.json({ success: true, botEnabled });
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=frame');
  const interval = setInterval(async () => {
    if (bot.browserService.page && !bot.browserService.page.isClosed()) {
      try {
        const buf = await bot.browserService.takeScreenshot();
        if (buf) {
          res.write(`--frame\r\nContent-Type: image/webp\r\n\r\n`);
          res.write(Buffer.from(buf, 'base64'));
          res.write(`\r\n`);
        }
      } catch (e) { }
    }
  }, 1000);
  req.on('close', () => clearInterval(interval));
});

app.get('/api/screenshot', (req, res) => {
  res.json({
    image: bot.latestScreenshot,
    url: bot.latestScreenshotUrl
  });
});

app.post('/api/test-email', async (req, res) => {
  try {
    await bot.emailService.sendNotification('Test Class', '12:00 PM', 'TEST');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ========== START ==========

app.listen(PORT, () => {
  console.log(`🚀 Modular Bot V3 Dashboard: http://localhost:${PORT}`);
  // Perform a SILENT sync on startup to populate the dashboard UI
  syncSchedule(false); 
});

// Cron hooks - Updated to match your 11 AM / 5 PM preference
schedule.scheduleJob({ hour: 11, minute: 0, tz: 'Asia/Kolkata' }, () => syncSchedule(true));
schedule.scheduleJob({ hour: 17, minute: 0, tz: 'Asia/Kolkata' }, () => syncSchedule(true));
