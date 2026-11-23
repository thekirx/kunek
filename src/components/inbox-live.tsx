"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveInboxAction, LiveInboxSnapshot } from "@/lib/inbox/live-types";

const realtimeTables = ["conversations", "messages", "conversation_notes", "channels", "contacts", "conversation_assignments", "tags", "contact_tags"];

export class InboxMutationError extends Error {
  constructor(message: string, readonly status?: string) {
    super(message);
  }
}

export function useLiveInbox(initial?: LiveInboxSnapshot) {
  const organizationId = initial?.organizationId;
  const [snapshot, setSnapshot] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async (reason: "manual" | "background" | "mutation" = "manual") => {
    if (!organizationId || (reason === "background" && request.current)) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (reason === "manual") setRefreshing(true);

    try {
      const response = await fetch(`/api/inbox?${new URLSearchParams({ organizationId })}`, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      const result = await response.json();
      if (!response.ok || result.organizationId !== organizationId || !Array.isArray(result.conversations)) {
        throw new Error(result.error || "Couldn’t refresh the inbox. Try again.");
      }
      if (!controller.signal.aborted) {
        setSnapshot(result);
        setRefreshError("");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setRefreshError(error instanceof Error && !["SyntaxError", "TypeError", "TimeoutError"].includes(error.name)
          ? error.message : "Couldn’t refresh the inbox. Try again.");
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setRefreshing(false);
      }
    }
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    let timer: number | undefined;
    let closed = false;
    function scheduleRefresh() {
      if (closed) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh("mutation"), 200);
    }
    function refreshVisible() {
      if (document.visibilityState === "visible") void refresh("background");
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const client = url && key ? createBrowserClient(url, key) : null;
    const channel = client?.channel(`oniro-inbox:${organizationId}:${crypto.randomUUID()}`);
    for (const table of realtimeTables) {
      const scope = { schema: "public", table, filter: `organization_id=eq.${organizationId}` };
      channel?.on("postgres_changes", { ...scope, event: "INSERT" }, scheduleRefresh);
      channel?.on("postgres_changes", { ...scope, event: "UPDATE" }, scheduleRefresh);
    }
    channel?.subscribe((status) => {
      if (status === "SUBSCRIBED") scheduleRefresh();
    });

    const interval = window.setInterval(refreshVisible, 20_000);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      closed = true;
      if (channel) void client?.removeChannel(channel);
      window.clearTimeout(timer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshVisible);
      request.current?.abort();
      request.current = null;
    };
  }, [organizationId, refresh]);

  async function mutate(conversationId: string, action: LiveInboxAction, value?: string | null, requestId?: string) {
    const fallback = action === "reply" ? "Messenger hasn’t confirmed this reply. Check the thread before retrying." : "Couldn’t save your change. Try again.";
    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, conversationId, action, value, requestId }),
        signal: AbortSignal.timeout(30_000),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        if (action === "reply" && response.status >= 500 && !result.status) throw new InboxMutationError(fallback, "unknown");
        throw new InboxMutationError(result.error || fallback, result.status);
      }
    } catch (error) {
      if (action === "reply") void refresh("mutation");
      if (error instanceof InboxMutationError) throw error;
      throw new InboxMutationError(fallback, action === "reply" ? "unknown" : undefined);
    }
    void refresh("mutation");
  }

  return { snapshot, refresh, refreshing, refreshError, mutate };
}
