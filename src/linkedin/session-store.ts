import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppConfig } from "../config/env.js";

interface EncryptedSession {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

function parseCookieHeader(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return cookies;
}

function encryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function decrypt(payload: EncryptedSession, secret: string): string {
  if (payload.version !== 1) throw new Error("Unsupported LinkedIn session file version.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function encrypt(cookieHeader: string, secret: string): EncryptedSession {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(cookieHeader, "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export class LinkedInSessionStore {
  private readonly cookies = new Map<string, string>();
  private saveQueue: Promise<void> = Promise.resolve();

  private constructor(private readonly config: AppConfig) {}

  static async create(config: AppConfig): Promise<LinkedInSessionStore> {
    const store = new LinkedInSessionStore(config);
    await store.load();
    return store;
  }

  hasSession(): boolean {
    return Boolean(this.cookies.get("li_at") && this.cookies.get("JSESSIONID"));
  }

  csrfToken(): string {
    return (this.cookies.get("JSESSIONID") ?? "").replace(/^"|"$/g, "");
  }

  cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  async absorb(response: Response): Promise<void> {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = headers.getSetCookie?.() ?? [];
    let changed = false;

    for (const setCookie of setCookies) {
      const pair = setCookie.split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expiresAt = /(?:^|;\s*)expires=([^;]+)/i.exec(setCookie)?.[1];
      const expired = /(?:^|;\s*)max-age=0(?:;|$)/i.test(setCookie)
        || (expiresAt !== undefined && Date.parse(expiresAt) <= Date.now());
      if (expired) {
        // A single endpoint can reject one web surface while another remains
        // valid. Never erase primary credentials from a response; explicit
        // authentication errors decide whether operator re-auth is required.
        if (name !== "li_at" && name !== "JSESSIONID") {
          changed = this.cookies.delete(name) || changed;
        }
      } else if (this.cookies.get(name) !== value) {
        this.cookies.set(name, value);
        changed = true;
      }
    }

    if (changed) await this.persist();
  }

  private async load(): Promise<void> {
    const { LINKEDIN_SESSION_FILE: file, LINKEDIN_SESSION_KEY: secret } = this.config;
    if (file && secret) {
      try {
        const payload = JSON.parse(await readFile(file, "utf8")) as EncryptedSession;
        for (const [name, value] of parseCookieHeader(decrypt(payload, secret))) this.cookies.set(name, value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new Error(`Could not load encrypted LinkedIn session file: ${(error as Error).message}`);
        }
      }
    }

    const encodedCookieHeader = this.config.LINKEDIN_BROWSER_COOKIE_HEADER_BASE64
      ?? this.config.LINKEDIN_COOKIE_HEADER_BASE64;
    const cookieHeader = encodedCookieHeader
      ? Buffer.from(encodedCookieHeader, "base64").toString("utf8")
      : this.config.LINKEDIN_COOKIE_HEADER;
    if (encodedCookieHeader) this.cookies.clear();
    for (const [name, value] of parseCookieHeader(cookieHeader)) {
      this.cookies.set(name, value);
    }
    for (const [name, value] of parseCookieHeader(this.config.LINKEDIN_COOKIE_PATCH_HEADER)) {
      this.cookies.set(name, value);
    }
    if (this.config.LINKEDIN_LI_AT) this.cookies.set("li_at", this.config.LINKEDIN_LI_AT);
    if (this.config.LINKEDIN_JSESSION_ID) this.cookies.set("JSESSIONID", this.config.LINKEDIN_JSESSION_ID);

    if (this.hasSession() && file && secret) await this.persist();
  }

  private async persist(): Promise<void> {
    const { LINKEDIN_SESSION_FILE: file, LINKEDIN_SESSION_KEY: secret } = this.config;
    if (!file || !secret) return;
    const payload = `${JSON.stringify(encrypt(this.cookieHeader(), secret))}\n`;
    this.saveQueue = this.saveQueue.then(async () => {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temporaryFile = `${file}.${process.pid}.tmp`;
      await writeFile(temporaryFile, payload, { encoding: "utf8", mode: 0o600 });
      await chmod(temporaryFile, 0o600);
      await rename(temporaryFile, file);
    });
    await this.saveQueue;
  }
}
