import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const actorSchema = z.object({ userId: z.string(), organizationId: z.string(), nonce: z.string() });
const stateSchema = actorSchema.extend({ expiresAt: z.number().int() });
const stateLifetimeMs = 10 * 60 * 1000;

type OAuthActor = z.infer<typeof actorSchema>;

export function createOAuthState(actor: OAuthActor, secret: string, now = Date.now()) {
  if (!secret) throw new Error("OAuth state secret is required");
  const state = stateSchema.parse({ ...actor, expiresAt: now + stateLifetimeMs });
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  return payload + "." + createHmac("sha256", secret).update(payload).digest("base64url");
}

export function readOAuthState(state: string, actor: OAuthActor, secret: string, now = Date.now()) {
  if (!secret || state.length > 4096) return false;
  const parts = state.split(".");
  if (parts.length !== 2) return false;
  const [payload, mac] = parts;
  const expected = Buffer.from(createHmac("sha256", secret).update(payload).digest("base64url"));
  const supplied = Buffer.from(mac);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;

  try {
    const value = stateSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return value.expiresAt > now && value.expiresAt <= now + stateLifetimeMs &&
      value.userId === actor.userId && value.organizationId === actor.organizationId && value.nonce === actor.nonce;
  } catch {
    return false;
  }
}

export function buildOAuthUrl(config: { appId: string; version: string; redirectUri: string; scopes: string[]; configId?: string }, state: string) {
  if (!/^v[0-9]+\.[0-9]+$/.test(config.version)) throw new Error("Invalid Graph API version");
  const url = new URL(`https://www.facebook.com/${config.version}/dialog/oauth`);
  url.search = new URLSearchParams({
    client_id: config.appId, redirect_uri: config.redirectUri, response_type: "code", state,
  }).toString();
  if (config.configId) url.searchParams.set("config_id", config.configId);
  else if (config.scopes.length) url.searchParams.set("scope", config.scopes.join(","));
  return url;
}

// Use the same immutable organization and channel context when sealing and opening.
export function sealPageToken(token: string, key: Buffer, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((value) => value.toString("base64url")).join(".");
}

export function openPageToken(envelope: string, key: Buffer, context: string) {
  const parts = envelope.split(".");
  if (parts.length !== 3) throw new Error("Invalid token envelope");
  const [iv, tag, ciphertext] = parts.map((value) => Buffer.from(value, "base64url"));
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid token envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
