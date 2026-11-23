import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { readMessengerEvents, verifySignature, verifySubscription } from "../src/lib/meta/webhook.ts";
import { createOAuthState, readOAuthState, sealPageToken, openPageToken } from "../src/lib/meta/oauth.ts";

const raw = readFileSync(new URL("./fixtures/messenger.json", import.meta.url), "utf8");
const secret = "test-secret";
const signature = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

test("verifies raw signatures and rejects changed bodies and malformed headers", () => {
  assert.equal(verifySignature(Buffer.from(raw), signature, secret), true);
  assert.equal(verifySignature(Buffer.from(raw + " "), signature, secret), false);
  assert.equal(verifySignature(Buffer.from(raw), "sha256=oops", secret), false);
  assert.equal(verifySignature(Buffer.from(raw), signature, ""), false);
});

test("returns the subscription challenge only for the configured token", () => {
  const query = new URLSearchParams("hub.mode=subscribe&hub.verify_token=token&hub.challenge=42");
  assert.equal(verifySubscription(query, "token"), "42");
  assert.equal(verifySubscription(query, "other"), null);
  assert.equal(verifySubscription(query, ""), null);
});

test("normalizes page messages and deduplicates by Page and message ID", () => {
  const payload = JSON.parse(raw);
  const message = payload.entry[0].messaging[0];
  payload.entry[0].messaging.push(message, { ...message, message: { ...message.message, is_echo: true } });
  assert.deepEqual(readMessengerEvents(payload), [{
    pageId: "123456789", senderId: "234567890", messageId: "m_demo_001",
    timestamp: 1737691200000, text: "Do you deliver to Quezon City?",
  }]);
  assert.throws(() => readMessengerEvents({ object: "page" }));
});

test("OAuth state is bound to actor, organization and browser and expires", () => {
  const actor = { userId: "agent-1", organizationId: "org-1", nonce: "cookie-1" };
  const now = 1737691200000;
  const state = createOAuthState(actor, secret, now);
  assert.equal(readOAuthState(state, actor, secret, now + 100), true);
  assert.equal(readOAuthState(state, { ...actor, nonce: "cookie-2" }, secret, now), false);
  assert.equal(readOAuthState(state, { ...actor, organizationId: "org-2" }, secret, now), false);
  assert.equal(readOAuthState(state, actor, secret, now + 600_001), false);
  assert.equal(readOAuthState(state + "x", actor, secret, now), false);
});

test("encrypted tokens are bound to their channel and cannot be altered", () => {
  const key = Buffer.alloc(32, 4);
  const encrypted = sealPageToken("test-page-token", key, "org:page");
  assert.equal(openPageToken(encrypted, key, "org:page"), "test-page-token");
  assert.throws(() => openPageToken(encrypted, key, "other:page"));
  const altered = encrypted.split(".");
  const bytes = Buffer.from(altered[2], "base64url");
  bytes[0] ^= 1;
  altered[2] = bytes.toString("base64url");
  assert.throws(() => openPageToken(altered.join("."), key, "org:page"));
});
