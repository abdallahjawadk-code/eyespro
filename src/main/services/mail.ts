import { postJson } from '../net/http';
import { getSetting } from './settings';

export interface MailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export function buildResetEmail(code: string, username: string, minutes = 30): MailPayload {
  const subject = 'EyesPro — Password reset code';
  const text = `Your reset code: ${code}\nUsername: ${username}\nValid ${minutes} minutes.`;
  const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
    <h2 style="color:#6366f1">EyesPro</h2>
    <p>رمز إعادة تعيين كلمة المرور:</p>
    <p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
    <p>المستخدم: <strong>${username}</strong></p>
    <p style="color:#666;font-size:13px">صالح ${minutes} دقيقة — © Masar Network</p>
  </div>`;
  return { to: '', subject, html, text };
}

export async function sendMail(payload: MailPayload): Promise<{ ok: boolean; error?: string; provider?: string }> {
  if (getSetting('password_reset_enabled') === '0') {
    return { ok: false, error: 'Password reset email disabled in settings' };
  }
  if (!payload.to?.includes('@')) return { ok: false, error: 'Invalid recipient' };

  const provider = (getSetting('mail_provider') || 'sendgrid').toLowerCase();
  if (provider === 'sendgrid' || getSetting('sendgrid_api_key')) {
    return sendViaSendGrid(payload);
  }
  return sendViaSmtp(payload);
}

async function sendViaSendGrid(payload: MailPayload): Promise<{ ok: boolean; error?: string; provider?: string }> {
  const key = getSetting('sendgrid_api_key');
  const from = getSetting('sendgrid_from_email');
  if (!key || !from) return { ok: false, error: 'SendGrid not configured' };
  const res = await postJson(
    'https://api.sendgrid.com/v3/mail/send',
    {
      personalizations: [{ to: [{ email: payload.to }] }],
      from: { email: from, name: getSetting('password_reset_from_name') || 'EyesPro' },
      subject: payload.subject,
      content: [
        { type: 'text/plain', value: payload.text || payload.html.replace(/<[^>]+>/g, '') },
        { type: 'text/html', value: payload.html }
      ]
    },
    { Authorization: `Bearer ${key}` }
  );
  return res.ok ? { ok: true, provider: 'sendgrid' } : { ok: false, error: res.body.slice(0, 200) };
}

async function sendViaSmtp(payload: MailPayload): Promise<{ ok: boolean; error?: string; provider?: string }> {
  const host = getSetting('email_smtp_host');
  const user = getSetting('email_smtp_user');
  const pass = getSetting('email_smtp_pass');
  if (!user || !pass) return { ok: false, error: 'SMTP not configured (email_smtp_user / email_smtp_pass)' };
  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: host || 'smtp.gmail.com',
      port: Number(getSetting('email_smtp_port') || '587'),
      secure: false,
      auth: { user, pass }
    });
    await transporter.sendMail({
      from: `"${getSetting('password_reset_from_name') || 'EyesPro'}" <${user}>`,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html
    });
    return { ok: true, provider: 'smtp' };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 220) };
  }
}
