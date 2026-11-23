import { MetaGraphError } from "./graph.ts";

export type ReplyState = "queued" | "sent" | "failed" | "delivered" | "read";
export type ReplyReservation = {
  message_id: string;
  status: ReplyState;
  should_send: boolean;
  page_id?: string;
  recipient_id?: string;
  token_ciphertext?: string;
};

export async function deliverReply(reservation: ReplyReservation, transport: {
  decrypt: (value: string, pageId: string) => string;
  send: (pageId: string, token: string, recipientId: string) => Promise<string>;
  finish: (outcome: "sent" | "failed" | "unknown", externalId?: string) => Promise<void>;
}): Promise<{ status: ReplyState; error?: string }> {
  if (!reservation.should_send) return { status: reservation.status };

  let outcome: "sent" | "failed" | "unknown";
  let externalId: string | undefined;
  let detail: string | undefined;
  let token: string;
  try {
    if (!reservation.page_id || !reservation.recipient_id || !reservation.token_ciphertext) throw new Error("Missing credential");
    token = transport.decrypt(reservation.token_ciphertext, reservation.page_id);
  } catch {
    try {
      await transport.finish("failed");
      return { status: "failed", error: "Page credentials could not be read. Ask a manager to reconnect the Page." };
    } catch {
      return { status: "queued" };
    }
  }

  try {
    externalId = await transport.send(reservation.page_id, token, reservation.recipient_id);
    outcome = "sent";
  } catch (error) {
    outcome = error instanceof MetaGraphError && error.kind !== "ambiguous" ? "failed" : "unknown";
    if (error instanceof MetaGraphError && error.kind === "auth") {
      detail = "Meta rejected the Page credentials. Ask a manager to reconnect the Page.";
    }
  }

  try {
    await transport.finish(outcome, externalId);
    return outcome === "unknown" ? { status: "queued" } : detail
      ? { status: outcome, error: detail }
      : { status: outcome };
  } catch {
    return { status: "queued" };
  }
}
