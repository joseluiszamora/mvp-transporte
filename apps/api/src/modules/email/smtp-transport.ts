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

export interface SmtpConfiguration {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  from: string;
  user?: string;
  password?: string;
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

export function validateSmtpConfiguration(configuration: SmtpConfiguration): SmtpConfiguration {
  const host = requiredSetting(configuration.host, "SMTP_HOST", 255);
  const from = requiredSetting(configuration.from, "SMTP_FROM", 320);
  const addressMatch = /^([^<>]*)<([^<>]+)>$/u.exec(from);
  const mailbox = addressMatch?.[2] ?? from;
  const port = configuration.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("SMTP_PORT must be a valid port.");
  if (/[\s/\\@]/u.test(host)) throw new Error("SMTP_HOST is invalid.");
  if ((!addressMatch && /[<>]/u.test(from)) || !/^[^\s<>@]+@[^\s<>@.]+(?:\.[^\s<>@.]+)+$/u.test(mailbox) || mailbox.includes("..")) throw new Error("SMTP_FROM is invalid.");
  const user = configuration.user?.trim() ?? "";
  const password = configuration.password ?? "";
  if (Boolean(user) !== Boolean(password)) throw new Error("SMTP credentials must be configured together.");
  if (user.length > 320 || /[\r\n\0]/u.test(user) || Buffer.byteLength(password, "utf8") > 1_024 || /[\0]/u.test(password)) {
    throw new Error("SMTP credentials are invalid.");
  }
  if (typeof configuration.secure !== "boolean" || typeof configuration.requireTls !== "boolean") {
    throw new Error("SMTP TLS settings are invalid.");
  }
  if (user && !configuration.secure && !configuration.requireTls) {
    throw new Error("SMTP authentication requires TLS.");
  }
  return { host, port, secure: configuration.secure, requireTls: configuration.requireTls, from, ...(user ? { user, password } : {}) };
}

export function readEnvironmentSmtpConfiguration(environment: NodeJS.ProcessEnv = process.env): SmtpConfiguration | null {
  const hasConfiguration = Boolean(environment.SMTP_HOST?.trim() || environment.SMTP_PORT?.trim() || environment.SMTP_FROM?.trim());
  if (!hasConfiguration) return null;
  const host = requiredSetting(environment.SMTP_HOST, "SMTP_HOST", 255);
  const rawPort = requiredSetting(environment.SMTP_PORT, "SMTP_PORT", 5);
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("SMTP_PORT must be a valid port.");
  const secure = parseBoolean(environment.SMTP_SECURE, "SMTP_SECURE", port === 465);
  const from = requiredSetting(environment.SMTP_FROM, "SMTP_FROM", 320);
  const user = environment.SMTP_USER?.trim() ?? "";
  const password = environment.SMTP_PASSWORD ?? "";
  if (Boolean(user) !== Boolean(password)) throw new Error("SMTP credentials must be configured together.");
  const requireTls = parseBoolean(environment.SMTP_REQUIRE_TLS, "SMTP_REQUIRE_TLS", Boolean(user && !secure));
  return validateSmtpConfiguration({ host, port, secure, requireTls, from, ...(user ? { user, password } : {}) });
}

export function createSmtpEmailSender(
  configurationOrEnvironment: SmtpConfiguration | NodeJS.ProcessEnv = process.env,
): EmailSender {
  const configuration = "host" in configurationOrEnvironment
    ? validateSmtpConfiguration(configurationOrEnvironment as SmtpConfiguration)
    : readEnvironmentSmtpConfiguration(configurationOrEnvironment as NodeJS.ProcessEnv);
  if (!configuration) throw new Error("SMTP is not configured.");
  const { host, port, secure, from, requireTls } = configuration;
  const auth = configuration.user && configuration.password
    ? { user: configuration.user, pass: configuration.password }
    : undefined;

  const transport: Transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: requireTls,
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
