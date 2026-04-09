const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class BrowserService {
  constructor(logger) {
    this.browser = null;
    this.page = null;
    this.logger = logger;
    this.sessionPath = path.join(process.cwd(), 'data', 'session.json');
  }

  async launch(blockResources = false) {
    if (this.browser) {
      try {
        await this.browser.version();
        return this.page;
      } catch {
        this.browser = null;
        this.page = null;
      }
    }

    // Ensure data dir exists for session storage
    await fs.mkdir(path.dirname(this.sessionPath), { recursive: true }).catch(() => { });

    this.logger.log('Launching optimized browser...');
    this.browser = await puppeteer.launch({
      headless: 'new',
      ignoreHTTPSErrors: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--no-zygote',
        '--ignore-certificate-errors',
        '--disable-features=IsolateOrigins,site-per-process'
      ],
      defaultViewport: { width: 1280, height: 720 }
    });

    this.page = await this.browser.newPage();
    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    if (blockResources) {
      await this.setResourceBlocking(true);
    }

    return this.page;
  }

  async setResourceBlocking(enabled) {
    if (!this.page) return;
    
    // Define the handler once so we can remove it later
    if (!this._requestHandler) {
      this._requestHandler = (req) => {
        try {
          const resourceType = req.resourceType();
          if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
            req.abort();
          } else {
            req.continue();
          }
        } catch (e) {
          // Ignore errors if interception was disabled mid-flight
        }
      };
    }

    if (enabled) {
      await this.page.setRequestInterception(true);
      this.page.on('request', this._requestHandler);
    } else {
      await this.page.setRequestInterception(false);
      this.page.off('request', this._requestHandler);
    }
  }

  async saveSession() {
    if (!this.page) return;
    try {
      const cookies = await this.page.cookies();
      const localStorage = await this.page.evaluate(() => JSON.stringify(window.localStorage));
      await fs.writeFile(this.sessionPath, JSON.stringify({ cookies, localStorage }, null, 2));
      this.logger.log('✅ Session saved securely.');
    } catch (e) {
      this.logger.log(`⚠️ Failed to save session: ${e.message}`, 'error');
    }
  }

  async loadSession() {
    if (!this.page) return false;
    try {
      const data = await fs.readFile(this.sessionPath, 'utf8');
      const { cookies, localStorage } = JSON.parse(data);

      await this.page.setCookie(...cookies);
      await this.page.evaluate((data) => {
        const ls = JSON.parse(data);
        for (const key in ls) { window.localStorage.setItem(key, ls[key]); }
      }, localStorage);

      this.logger.log('🔄 Session restored from local cache.');
      return true;
    } catch (e) {
      return false;
    }
  }

  async humanDelay(min = 1000, max = 3000) {
    const ms = Math.floor(Math.random() * (max - min + 1) + min);
    return new Promise(r => setTimeout(r, ms));
  }

  async takeScreenshot() {
    if (this.page && !this.page.isClosed()) {
      try {
        return await this.page.screenshot({ encoding: 'base64', type: 'webp', quality: 50 });
      } catch (e) { return null; }
    }
    return null;
  }

  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
        this.logger.log('Browser closed safely.');
      } catch (e) {
        this.logger.log(`Error: ${e.message}`, 'error');
      } finally {
        this.browser = null;
        this.page = null;
      }
    }
  }
}

module.exports = BrowserService;
