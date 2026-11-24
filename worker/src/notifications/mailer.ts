import nodemailer, { type Transporter } from 'nodemailer';
import { workerLogger } from '../config';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

let transporter: Transporter | null = null;
let customTransportHandler: ((msg: EmailMessage) => Promise<void>) | null = null;

export function setCustomMailSenderForTests(
  handler: ((msg: EmailMessage) => Promise<void>) | null,
): void {
  customTransportHandler = handler;
}

function getTransporter(): Transporter {
  if (!transporter) {
    const host = process.env.SMTP_HOST || 'localhost';
    const port = Number(process.env.SMTP_PORT || 1025);
    const secure = process.env.SMTP_SECURE === 'true';
    const user = process.env.SMTP_USER || '';
    const pass = process.env.SMTP_PASS || '';

    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...(user ? { auth: { user, pass } } : {}),
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 8000,
    });
  }
  return transporter;
}

export async function sendAlertEmail(msg: EmailMessage): Promise<void> {
  if (customTransportHandler) {
    await customTransportHandler(msg);
    return;
  }

  const from = process.env.SMTP_FROM || 'Pulsewatch Alerts <alerts@pulsewatch.dev>';
  try {
    await getTransporter().sendMail({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  } catch (err) {
    workerLogger.warn({ err, to: msg.to, subject: msg.subject }, 'SMTP email delivery failed');
    throw err;
  }
}

export function renderAlertEmailHtml(params: {
  title: string;
  body: string;
  severityColor: string;
  ctaUrl?: string;
}): string {
  return `<!DOCTYPE html>
<html>
  <body style="font-family: Inter, -apple-system, sans-serif; background: #f7f8fc; padding: 24px; color: #202238;">
    <div style="max-width: 540px; margin: 0 auto; background: #ffffff; border: 1px solid #e9eaf0; border-radius: 12px; overflow: hidden;">
      <div style="height: 5px; background: ${params.severityColor};"></div>
      <div style="padding: 24px;">
        <div style="font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #7657e8; margin-bottom: 8px;">PULSEWATCH ALERT</div>
        <h2 style="margin: 0 0 12px; font-size: 18px; color: #202238;">${params.title}</h2>
        <p style="margin: 0 0 20px; font-size: 13px; line-height: 1.6; color: #676a80;">${params.body}</p>
        ${
          params.ctaUrl
            ? `<a href="${params.ctaUrl}" style="display: inline-block; background: #7657e8; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 8px; font-size: 12px; font-weight: 600;">Open Pulsewatch Dashboard →</a>`
            : ''
        }
      </div>
    </div>
  </body>
</html>`;
}
