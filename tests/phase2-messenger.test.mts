import assert from "node:assert/strict";
import test from "node:test";
import { parseMessengerEvents } from "../src/lib/meta/events.ts";
import { deliverReply } from "../src/lib/meta/reply.ts";

const pageId = "101";
const senderId = "202";
const timestamp = 1737691200000;
const requestId = "717970ab-d559-4e6e-8f9c-3ac5d378c622";

test("normalizes inbound, echo, delivery and read events with Page direction", () => {
  const incoming = { sender: { id: senderId }, recipient: { id: pageId }, timestamp };
  const echo = { sender: { id: pageId }, recipient: { id: senderId }, timestamp };
  const events = parseMessengerEvents({ object: "page", entry: [{ id: pageId, messaging: [
    { ...incoming, message: { mid: "m1", text: "Hi" } },
    { ...incoming, message: { mid: "m1", text: "Hi" } },
    { ...echo, message: { mid: "m2", is_echo: true, metadata: requestId } },
    { ...incoming, delivery: { mids: ["m2"], watermark: timestamp } },
    { ...incoming, read: { watermark: timestamp } },
    { ...incoming, recipient: { id: "303" }, message: { mid: "wrong" } },
  ] }] });
  assert.deepEqual(events.map(({ kind, senderId }) => [kind, senderId]), [
    ["message", "202"], ["echo", "202"], ["delivery", "202"], ["read", "202"],
  ]);
  assert.equal(events[1].clientRequestId, requestId);
});

test("a reserved duplicate never reaches Meta, including an unknown outcome", async () => {
  const result = await deliverReply({ message_id: "mid", status: "queued", should_send: false }, {
    send: async () => { throw new Error("must not send"); },
    finish: async () => { throw new Error("must not finish"); },
    decrypt: () => { throw new Error("must not decrypt"); },
  });
  assert.deepEqual(result, { status: "queued" });
});

const reservation = { message_id: "mid", status: "queued", should_send: true, page_id: "101", recipient_id: "202", token_ciphertext: "encrypted" } as const;

test("an unsuccessful API call is never reported as sent and ambiguous failures are reserved", async () => {
  const finishes: string[] = [];
  const ambiguous = new Error("network");
  const result = await deliverReply(reservation, {
    send: async () => { throw ambiguous; },
    finish: async (outcome) => { finishes.push(outcome); },
    decrypt: () => "synthetic",
  });
  assert.deepEqual(result, { status: "queued" });
  assert.deepEqual(finishes, ["unknown"]);
});

test("a successful API acknowledgment still needs a durable status update", async () => {
  const result = await deliverReply(reservation, {
    send: async () => "provider-mid",
    finish: async () => { throw new Error("database unavailable"); },
    decrypt: () => "synthetic",
  });
  assert.deepEqual(result, { status: "queued" });
});
