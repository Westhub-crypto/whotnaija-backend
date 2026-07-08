const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

const templates = {
  welcome: (data) => ({
    subject: 'Welcome to WhotNaija 🃏 - Verify Your Email',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a1a; color: #fff; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #f5a623, #e84393); padding: 30px; text-align: center;">
          <h1 style="margin: 0; font-size: 28px;">🃏 WhotNaija</h1>
          <p style="margin: 5px 0 0; opacity: 0.9;">Nigeria's Premier Whot Card Game</p>
        </div>
        <div style="padding: 30px;">
          <h2>Welcome, ${data.name}! 🎉</h2>
          <p>You've successfully registered on WhotNaija. Your account comes with a ₦500 welcome bonus!</p>
          <p>Please verify your email to activate your account:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.verifyUrl}" style="background: linear-gradient(135deg, #f5a623, #e84393); color: #fff; padding: 14px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Verify Email</a>
          </div>
          <p style="color: #aaa; font-size: 13px;">This link expires in 24 hours. If you didn't register, please ignore this email.</p>
        </div>
        <div style="background: #111; padding: 20px; text-align: center; color: #666; font-size: 12px;">
          <p>© 2024 WhotNaija. All rights reserved.</p>
        </div>
      </div>
    `,
  }),
  passwordReset: (data) => ({
    subject: 'WhotNaija - Password Reset Request',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0a1a; color: #fff; border-radius: 12px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #f5a623, #e84393); padding: 30px; text-align: center;">
          <h1 style="margin: 0;">🃏 WhotNaija</h1>
        </div>
        <div style="padding: 30px;">
          <h2>Password Reset</h2>
          <p>Hi ${data.name}, you requested a password reset.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${data.resetUrl}" style="background: linear-gradient(135deg, #f5a623, #e84393); color: #fff; padding: 14px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Reset Password</a>
          </div>
          <p style="color: #aaa; font-size: 13px;">This link expires in 1 hour. If you didn't request this, please ignore.</p>
        </div>
      </div>
    `,
  }),
};

async function sendEmail({ to, subject, template, data, html }) {
  try {
    const emailContent = template && templates[template]
      ? templates[template](data)
      : { subject, html };

    await transporter.sendMail({
      from: `"${process.env.FROM_NAME || 'WhotNaija'}" <${process.env.FROM_EMAIL}>`,
      to,
      subject: emailContent.subject || subject,
      html: emailContent.html || html,
    });

    logger.info(`Email sent to ${to}`);
  } catch (err) {
    logger.error(`Email failed to ${to}:`, err.message);
    throw err;
  }
}

module.exports = { sendEmail };
