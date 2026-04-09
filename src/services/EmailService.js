const axios = require('axios');

class EmailService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Internal helper for Brevo V3 API
   */
  async _sendApiEmail({ to, subject, html, attachments = [] }) {
    if (!this.config.pass || !this.config.sender) {
      throw new Error('Brevo API Key or Sender Email not configured.');
    }

    const data = {
      sender: { name: "Autoclass Bot", email: this.config.sender },
      to: [{ email: to, name: to }],
      subject: subject,
      htmlContent: html
    };

    if (attachments && attachments.length > 0) {
      data.attachment = attachments;
    }

    try {
      const response = await axios.post("https://api.brevo.com/v3/smtp/email", data, {
        headers: {
          "api-key": this.config.pass, // Uses current BREVO_API value
          "content-type": "application/json"
        }
      });
      return response.data;
    } catch (error) {
      const errMsg = error.response?.data?.message || error.message;
      this.logger.log(`❌ Brevo API Error: ${errMsg}`, 'error');
      throw error;
    }
  }

  async sendNotification(className, time, action = 'JOINED', screenshotBuffer = null) {
    const isVerification = action === 'VERIFIED';
    const statusText = isVerification ? 'Joined & Verified ✅' : `Class ${action === 'JOINED' ? 'Joined Successfully ✅' : 'Update'}`;
    const messageText = isVerification ? 'The bot has been in the class for 5 minutes.' : 'The bot is currently in the session.';

    const html = `
      <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 600px; margin: auto;">
        <h2 style="color: #2e7d32;">${statusText}</h2>
        <p><strong>Class:</strong> ${className}</p>
        <p><strong>Time:</strong> ${time}</p>
        <p><strong>Status:</strong> ${messageText}</p>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;" />
        <p style="font-size: 12px; color: #888;">Live status available on your Dashboard.</p>
      </div>
    `;

    const attachments = [];
    if (screenshotBuffer) {
      // Convert buffer (Base64 string or binary) to Base64 for Brevo API
      const content = screenshotBuffer.toString('base64');
      attachments.push({
        content: content,
        name: 'class-proof.webp'
      });
    }

    try {
      const result = await this._sendApiEmail({
        to: this.config.recipient,
        subject: `🎓 ${isVerification ? 'Verification' : 'Class ' + action}: ${className}`,
        html: html,
        attachments: attachments
      });
      this.logger.log(`📧 Email sent successfully via API! ID: ${result.messageId}`);
      return result;
    } catch (error) {
      // Silent fail for bot's main loop durability
      return null;
    }
  }

  async sendDailyBriefing(timetable) {
    const rows = timetable.map(c => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${c.name}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${c.time}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">
          <span style="background: #e8f5e9; color: #2e7d32; padding: 4px 8px; border-radius: 4px; font-size: 12px;">Scheduled</span>
        </td>
      </tr>
    `).join('');

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 12px; overflow: hidden;">
        <div style="background: #1a73e8; color: white; padding: 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 20px;">Today's Class Schedule</h1>
        </div>
        <div style="padding: 20px;">
          ${timetable.length > 0 ? `<table style="width: 100%; border-collapse: collapse;"><tbody>${rows}</tbody></table>` : '<p>No classes today.</p>'}
        </div>
      </div>
    `;

    try {
      const result = await this._sendApiEmail({
        to: this.config.recipient,
        subject: `📅 Daily Class Briefing - ${new Date().toLocaleDateString('en-IN')}`,
        html: html
      });
      this.logger.log(`📧 Daily briefing sent via API! ID: ${result.messageId}`);
      return result;
    } catch (error) {
      return null;
    }
  }
}

module.exports = EmailService;
