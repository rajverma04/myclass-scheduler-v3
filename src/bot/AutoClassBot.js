const BrowserService = require('../services/BrowserService');
const EmailService = require('../services/EmailService');
const ScraperService = require('../services/ScraperService');
require('dotenv').config();

const LOGIN_URL = 'https://myclass.lpu.in';
const BASE_URL = 'https://lovelyprofessionaluniversity.codetantra.com';
const TIMETABLE_URL = `${BASE_URL}/secure/tla/m.jsp`;

class AutoClassBot {
  constructor() {
    this.logs = [];
    this.isLoggedIn = false;
    this.status = 'idle';

    this.lastCheck = null;
    this.lastJoined = null;
    this.dailyTimetable = [];
    this.lastDailySync = null;
    this.noClassesFoundToday = false;

    this.totalActiveMinutes = 0;
    this.lastActiveMinuteUpdate = Date.now();

    this.latestScreenshot = null;
    this.latestScreenshotUrl = null;
    this.activeClassEndTime = null;

    // Initialize Services
    this.browserService = new BrowserService(this);
    this.scraperService = new ScraperService(this);
    this.emailService = new EmailService({
      recipient: (process.env.NOTIFICATION_EMAIL || '').trim(),
      sender: (process.env.SENDER_EMAIL || '').trim(),
      pass: (process.env.BREVO_API || '').trim(),
      login: (process.env.BREVO_LOGIN || '').trim()
    }, this);
  }

  log(message, level = 'info') {
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const entry = { timestamp, level, message };
    this.logs.push(entry);
    if (this.logs.length > 100) this.logs.shift();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`);

    if (this.browserService.page && !this.browserService.page.isClosed()) {
      this.browserService.takeScreenshot().then(b64 => {
        if (b64) {
          this.latestScreenshot = b64;
          this.latestScreenshotUrl = this.browserService.page.url();
        }
      }).catch(() => { });
    }
  }

  async login(regNumber, password) {
    try {
      const page = await this.browserService.launch();

      this.status = 'logging_in';
      this.log('Checking for active session...');

      const sessionRestored = await this.browserService.loadSession();
      await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });

      // Check if already on the Codetantra page (restored session)
      if (page.url().includes('codetantra.com') && !page.url().includes('login')) {
        this.log('🚀 Session restored! Skipping login form.');
        this.isLoggedIn = true;
        this.status = 'logged_in';
        return true;
      }

      this.log(`Typing credentials for ${regNumber}...`);
      const userField = await page.waitForSelector('input[aria-label="user name"], input[placeholder="Username"]', { timeout: 10000 });
      const passField = await page.$('#pwd-field') || await page.$('input[type="password"]');

      if (!userField || !passField) throw new Error('Login fields not found');

      await userField.type(regNumber, { delay: 50 });
      await passField.type(password, { delay: 50 });
      await page.keyboard.press('Enter');

      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => { });

      if (page.url().includes('codetantra.com')) {
        this.isLoggedIn = true;
        this.status = 'logged_in';
        await this.browserService.saveSession();
        return true;
      }
      return false;
    } catch (e) {
      this.log(`Login failed: ${e.message}`, 'error');
      return false;
    }
  }

  async checkAndJoin(regNumber, password, forceScan = false) {
    const now = Date.now();
    const today = new Date().toDateString();

    try {
      const istTime = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
      this.lastCheck = `Today, ${istTime}`;

      if (this.lastDailySync === today && this.noClassesFoundToday && !forceScan) {
        this.status = 'no_classes_today';
        return { joined: false, action: 'skip_no_classes' };
      }

      this.log(forceScan ? '⚡ Manual check triggered...' : '⏰ Scheduled check triggered.');

      // Optimized Sync (Blocks CSS/Images)
      if (this.lastDailySync !== today || forceScan) {
        this.log('🌅 Morning Sync starting (Optimized Mode)...');
        await this.browserService.launch(true); // Launch with resource blocking
        const loggedIn = await this.login(regNumber, password);
        if (loggedIn) {
          await this.browserService.page.goto(TIMETABLE_URL, { waitUntil: 'networkidle2' });
          await this.browserService.page.evaluate(() => {
            const btn = document.querySelector('.fc-listView-button') || document.querySelector('button[title="list view"]');
            if (btn) btn.click();
          });
          await this.browserService.humanDelay(2000, 3000);

          this.dailyTimetable = await this.scraperService.scrapeClasses(this.browserService.page);
          this.noClassesFoundToday = (this.dailyTimetable.length === 0);
          this.lastDailySync = today;
          this.log(`Sync complete. Found ${this.dailyTimetable.length} classes.`);
          await this.browserService.setResourceBlocking(false); // Unblock for later use
        }
      }

      // Check timers
      if (this.status === 'joined' && this.activeClassEndTime) {
        if (now < this.activeClassEndTime && !forceScan) return { joined: true, action: 'skip' };
        this.status = 'idle';
      }

      // Join Logic
      if (!this.isLoggedIn) await this.login(regNumber, password);

      await this.browserService.page.goto(TIMETABLE_URL, { waitUntil: 'networkidle2' });
      const currentClasses = await this.scraperService.scrapeClasses(this.browserService.page);

      const ongoing = currentClasses.find(c => {
        const times = c.time.split(/[-]|to/i).map(t => this.scraperService.parseSingleTime(t));
        return times[0] && times[1] && now >= (times[0] - 15 * 60000) && now < times[1];
      });

      if (ongoing) {
        this.log(`🎯 Class ongoing: ${ongoing.name}. Joining...`);
        const joinUrl = `${BASE_URL}/secure/tla/jnr.jsp?m=${ongoing.meetingId}`;
        await this.browserService.page.goto(joinUrl, { waitUntil: 'networkidle2' });

        await this.browserService.page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.toLowerCase().includes('listen only'));
          if (btn) btn.click();
        });

        this.status = 'joined';
        this.lastJoined = { name: ongoing.name, time: ongoing.time };
        this.activeClassEndTime = this.scraperService.parseEndTime(ongoing.time);
        await this.emailService.sendNotification(ongoing.name, ongoing.time, 'JOINED');
        return { joined: true, name: ongoing.name };
      }

      this.status = 'waiting';
      await this.browserService.close(); // Save memory between checks
      this.updateActiveTime();
      return { joined: false, action: 'waiting' };

    } catch (e) {
      this.log(`Error: ${e.message}`, 'error');
      return { joined: false, error: e.message };
    }
  }

  updateActiveTime() {
    const now = Date.now();
    const diff = now - this.lastActiveMinuteUpdate;
    if (diff >= 60000) {
      this.totalActiveMinutes += Math.floor(diff / 60000);
      this.lastActiveMinuteUpdate = now - (diff % 60000);
    }
  }

  getStatus() {
    this.updateActiveTime();
    return {
      status: this.status,
      isLoggedIn: this.isLoggedIn,
      lastCheck: this.lastCheck,
      lastJoined: this.lastJoined,
      timetable: this.dailyTimetable,
      logs: this.logs.slice(-20),
      uptime: process.uptime(),
      activeMinutes: this.totalActiveMinutes,
      screenshotAvailable: !!(this.latestScreenshot)
    };
  }
}

module.exports = AutoClassBot;
