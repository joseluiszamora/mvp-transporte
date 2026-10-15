import nodemailer from "nodemailer";
import type { SendMailOptions, Transporter } from "nodemailer";

export interface RenderedEmail {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: RenderedEmail): Promise<void>;
  close(): void;
}

function parseBoolean(value: string | undefined, name: string, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false.`);
}

function requiredSetting(value: string | undefined, name: string, maximumLength: number): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maximumLength || /[\r\n\0]/u.test(normalized)) {
    throw new Error(`${name} is invalid.`);
  }
  return normalized;
}

export function createSmtpEmailSender(
  environment: NodeJS.ProcessEnv = process.env,
): EmailSender {
  const host = requiredSetting(environment.SMTP_HOST, "SMTP_HOST", 255);
  const rawPort = requiredSetting(environment.SMTP_PORT, "SMTP_PORT", 5);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("SMTP_PORT must be a valid port.");
  }
  const secure = parseBoolean(environment.SMTP_SECURE, "SMTP_SECURE", port === 465);
  const from = requiredSetting(environment.SMTP_FROM, "SMTP_FROM", 320);
  const user = environment.SMTP_USER?.trim() ?? "";
  const password = environment.SMTP_PASSWORD ?? "";
  if (Boolean(user) !== Boolean(password)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must be configured together.");
  }
  const auth = user && password ? { user, pass: password } : undefined;
  const requireTLS = parseBoolean(environment.SMTP_REQUIRE_TLS, "SMTP_REQUIRE_TLS", Boolean(auth && !secure));

  const transport: Transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS,
    ...(auth ? { auth } : {}),
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 30_000,
    tls: { rejectUnauthorized: true },
  });

  return {
    async send(message: RenderedEmail): Promise<void> {
      const mail: SendMailOptions = {
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        disableFileAccess: true,
        disableUrlAccess: true,
      };
      await transport.sendMail(mail);
    },
    close(): void {
      transport.close();
    },
  };
}
