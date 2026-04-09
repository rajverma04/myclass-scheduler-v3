class ScraperService {
  constructor(logger) {
    this.logger = logger;
  }

  async scrapeClasses(page) {
    return await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('tr.fc-list-item').forEach(row => {
        const time = row.querySelector('.fc-list-item-time')?.textContent.trim() || '';
        const name = row.querySelector('.fc-list-item-title')?.textContent.trim() || '';
        const link = row.querySelector('a[href*="m="]');
        const meetingId = link ? new URLSearchParams(link.href.split('?')[1]).get('m') : '';
        results.push({ name, time, meetingId, status: 'scheduled' });
      });
      return results;
    });
  }

  async clickAndExtractMeetingId(page, idx) {
    await page.evaluate((i) => {
      const rows = document.querySelectorAll('tr.fc-list-item');
      if (rows[i]) rows[i].click();
    }, idx);
    await new Promise(resolve => setTimeout(resolve, 3000));
    return await page.evaluate(() => {
      const a = document.querySelector('a[href*="m="]');
      return a ? new URLSearchParams(a.href.split('?')[1]).get('m') : null;
    });
  }

  parseSingleTime(timeStr) {
    if (!timeStr) return null;
    try {
      const match = timeStr.trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (!match) return null;
      let hours = parseInt(match[1]);
      const mins = parseInt(match[2]);
      const ampm = match[3]?.toUpperCase();
      if (ampm === 'PM' && hours < 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;

      const nowUtc = Date.now();
      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
      const todayIst = new Date(nowUtc + IST_OFFSET_MS);
      const istMidnightUtc = Date.UTC(
        todayIst.getUTCFullYear(),
        todayIst.getUTCMonth(),
        todayIst.getUTCDate()
      ) - IST_OFFSET_MS;
      
      return istMidnightUtc + (hours * 60 + mins) * 60 * 1000;
    } catch { return null; }
  }

  parseEndTime(timeStr) {
    if (!timeStr) return null;
    const parts = timeStr.split(/[-]|to/i);
    return parts.length > 1 ? this.parseSingleTime(parts[1]) : null;
  }
}

module.exports = ScraperService;
