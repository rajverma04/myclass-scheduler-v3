const nodemailer = require('nodemailer');

class EmailService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  _getTransporter() {
    if (!this.config.login || !this.config.pass) return null;

    return nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false,
      requireTLS: true,
      pool: true,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
      auth: {
        user: this.config.login,
        pass: this.config.pass
      }
    });
  }

  async sendNotification(className, time, action = 'JOINED', screenshotBuffer = null) {
    const transporter = this._getTransporter();
    if (!transporter) throw new Error('SMTP credentials not configured.');

    const isVerification = action === 'VERIFIED';
    const statusText = isVerification ? 'Joined & Verified ✅' : `Class ${action === 'JOINED' ? 'Joined Successfully ✅' : 'Update'}`;
    const messageText = isVerification ? 'The bot has been in the class for 5 minutes.' : 'The bot is currently in the session.';

    const mailOptions = {
      from: `"AutoClass Bot" <${this.config.sender}>`,
      to: this.config.recipient,
      subject: `🎓 ${isVerification ? 'Verification' : 'Class ' + action}: ${className}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 600px; margin: auto;">
          <h2 style="color: #2e7d32;">${statusText}</h2>
          <p><strong>Class:</strong> ${className}</p>
          <p><strong>Time:</strong> ${time}</p>
          <p><strong>Status:</strong> ${messageText}</p>
          ${screenshotBuffer ? `<div style="margin-top: 20px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;"><img src="cid:screenshot" style="width: 100%; display: block;" /></div>` : ''}
          <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;" />
          <p style="font-size: 12px; color: #888;">Live status available on your Dashboard.</p>
        </div>
      `,
      attachments: screenshotBuffer ? [{
        filename: 'class-proof.webp',
        content: screenshotBuffer,
        cid: 'screenshot'
      }] : []
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      this.logger.log(`📧 Email sent successfully! ID: ${info.messageId}`);
      return info;
    } catch (error) {
      this.logger.log(`❌ SMTP Error: ${error.message}`, 'error');
      throw error;
    }
  }

  async sendDailyBriefing(timetable) {
    const transporter = this._getTransporter();
    if (!transporter) throw new Error('SMTP credentials not configured.');

    const rows = timetable.map(c => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${c.name}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">${c.time}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">
          <span style="background: #e8f5e9; color: #2e7d32; padding: 4px 8px; border-radius: 4px; font-size: 12px;">Scheduled</span>
        </td>
      </tr>
    `).join('');

    const mailOptions = {
      from: `"AutoClass Bot" <${this.config.sender}>`,
      to: this.config.recipient,
      subject: `📅 Daily Class Briefing - ${new Date().toLocaleDateString('en-IN')}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 12px; overflow: hidden;">
          <div style="background: #1a73e8; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 20px;">Today's Class Schedule</h1>
          </div>
          <div style="padding: 20px;">
            ${timetable.length > 0 ? `<table style="width: 100%; border-collapse: collapse;"><tbody>${rows}</tbody></table>` : '<p>No classes today.</p>'}
          </div>
        </div>
      `
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      this.logger.log(`📧 Daily briefing sent! ID: ${info.messageId}`);
      return info;
    } catch (error) {
      this.logger.log(`❌ Daily Briefing Error: ${error.message}`, 'error');
      throw error;
    }
  }
}

module.exports = EmailService;
