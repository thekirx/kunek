import { z } from "zod";

const graphOrigin = "https://graph.facebook.com";
const requestTimeoutMs = 10_000;
const accountsTimeoutMs = 15_000;
const maxAccountPages = 20;

const graphId = z.string().regex(/^[0-9]{1,32}$/);
const bearerToken = z.string().regex(/^[A-Za-z0-9._~+/-]+=*$/);
const appToken = z.string().regex(/^[0-9]{1,32}\|[A-Za-z0-9._~+/-]+=*$/);
const cursor = z.string().min(1).max(2048).regex(/^[A-Za-z0-9._~+/-]+=*$/);
const accountsResponse = z.object({
  data: z.array(z.object({
    id: graphId,
    name: z.string().min(1),
    access_token: bearerToken.nullish(),
  })),
  paging: z.object({
    next: z.string().min(1).optional(),
    cursors: z.object({ after: cursor.optional() }).optional(),
  }).optional(),
});
const tokenResponse = z.object({ access_token: bearerToken });
const pageResponse = z.object({ id: graphId });
const profileResponse = z.object({ first_name: z.string().nullish(), last_name: z.string().nullish() });
const subscriptionResponse = z.object({ success: z.literal(true) });
const removalResponse = subscriptionResponse.extend({ messaging_success: z.literal(true).optional() });
const sendResponse = z.object({ message_id: z.string().min(1) });
const graphErrorResponse = z.object({
  error: z.object({
    code: z.number().int(),
    error_subcode: z.number().int().optional(),
    is_transient: z.boolean().optional(),
  }),
});

const messages = {
  auth: "Meta authorization is invalid or lacks the required permissions.",
  rejected: "Meta rejected the request.",
  ambiguous: "Meta did not confirm the request outcome.",
};

type MetaGraphErrorKind = keyof typeof messages;
type OAuthExchange = { appId: string; appSecret: string; redirectUri: string; code: string };
export type MetaPage = { id: string; name: string; accessToken: string };

export class MetaGraphError extends Error {
  readonly kind: MetaGraphErrorKind;

  constructor(kind: MetaGraphErrorKind) {
    super(messages[kind]);
    this.name = "MetaGraphError";
    this.kind = kind;
  }
}

function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new MetaGraphError("ambiguous");
  return parsed.data;
}

function graphFailure(status: number, body: unknown): MetaGraphError {
  if (status < 400 || status >= 500 || status === 408 || status === 425 || status === 429) {
    return new MetaGraphError("ambiguous");
  }

  const parsed = graphErrorResponse.safeParse(body);
  if (!parsed.success) return new MetaGraphError("ambiguous");
  const { code, error_subcode: subcode, is_transient: transient } = parsed.data.error;
  if (transient || [1, 2, 4, 17, 32, 341, 613, 80001].includes(code)) {
    return new MetaGraphError("ambiguous");
  }
  // Messenger reports a closed reply window as a permission error with this subcode.
  if (code === 10 && subcode === 2018278) return new MetaGraphError("rejected");
  if (status === 401 || [3, 10, 102, 190].includes(code) || (code >= 200 && code <= 299)) {
    return new MetaGraphError("auth");
  }
  return new MetaGraphError("rejected");
}

function requirePageId(id: string) {
  if (!graphId.safeParse(id).success) throw new MetaGraphError("rejected");
}

// Server-side callers own the credentials returned by the exchange and Page list.
export function createMetaGraph(version: string, fetchImpl: typeof fetch = fetch) {
  if (!/^v[0-9]+\.[0-9]+$/.test(version)) throw new MetaGraphError("rejected");

  async function request(path: string, options: {
    query?: Record<string, string>;
    token?: string;
    method?: "GET" | "POST" | "DELETE";
    body?: string | URLSearchParams;
    signal?: AbortSignal;
  } = {}): Promise<unknown> {
    const url = new URL(`/${version}/${path}`, graphOrigin);
    url.search = new URLSearchParams(options.query).toString();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.token !== undefined) {
      const validBearer = bearerToken.safeParse(options.token).success;
      const validAppToken = options.method === "DELETE" && appToken.safeParse(options.token).success;
      if (!validBearer && !validAppToken) throw new MetaGraphError("auth");
      headers.Authorization = `Bearer ${options.token}`;
    }
    if (typeof options.body === "string") headers["Content-Type"] = "application/json";

    let response: Response;
    let payload: unknown;
    try {
      response = await fetchImpl(url, {
        method: options.method ?? "GET",
        headers,
        body: options.body,
        cache: "no-store",
        redirect: "error",
        signal: options.signal ?? AbortSignal.timeout(requestTimeoutMs),
      });
      payload = await response.json();
    } catch {
      throw new MetaGraphError("ambiguous");
    }
    if (!response.ok || graphErrorResponse.safeParse(payload).success) {
      throw graphFailure(response.status, payload);
    }
    return payload;
  }

  return {
    async profileName(recipientId: string, token: string) {
      requirePageId(recipientId);
      const profile = parseResponse(profileResponse, await request(recipientId, {
        token, query: { fields: "first_name,last_name" },
      }));
      return [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim().slice(0, 100);
    },

    async exchangeCode({ appId, appSecret, redirectUri, code }: OAuthExchange): Promise<string> {
      if (!appId || !appSecret || !redirectUri || !code) throw new MetaGraphError("auth");
      const payload = await request("oauth/access_token", {
        query: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code },
      });
      return parseResponse(tokenResponse, payload).access_token;
    },

    async pages(userToken: string): Promise<MetaPage[]> {
      const pages = new Map<string, MetaPage>();
      const cursors = new Set<string>();
      const signal = AbortSignal.timeout(accountsTimeoutMs);
      const query = { fields: "id,name,access_token", limit: "100" };
      let after: string | undefined;

      for (let index = 0; index < maxAccountPages; index += 1) {
        const payload = await request("me/accounts", {
          token: userToken,
          query: after ? { ...query, after } : query,
          signal,
        });
        const result = parseResponse(accountsResponse, payload);
        for (const { id, name, access_token: accessToken } of result.data) {
          if (accessToken) pages.set(id, { id, name, accessToken });
        }
        if (!result.paging?.next) return [...pages.values()];

        // The next URL can include credentials. Carry only the opaque cursor to the fixed endpoint.
        after = result.paging.cursors?.after;
        if (!after || cursors.has(after)) throw new MetaGraphError("ambiguous");
        cursors.add(after);
      }
      throw new MetaGraphError("ambiguous");
    },

    async verifyPage(pageId: string, token: string): Promise<void> {
      requirePageId(pageId);
      const payload = await request("me", { token, query: { fields: "id" } });
      if (parseResponse(pageResponse, payload).id !== pageId) throw new MetaGraphError("auth");
    },

    async subscribe(pageId: string, token: string): Promise<void> {
      requirePageId(pageId);
      const payload = await request(`${pageId}/subscribed_apps`, {
        method: "POST",
        token,
        body: new URLSearchParams({
          subscribed_fields: "messages,message_echoes,message_deliveries,message_reads",
        }),
      });
      parseResponse(subscriptionResponse, payload);
    },

    async unsubscribe(pageId: string, appAccessToken: string): Promise<void> {
      requirePageId(pageId);
      const payload = await request(`${pageId}/subscribed_apps`, {
        method: "DELETE",
        token: appAccessToken,
      });
      parseResponse(removalResponse, payload);
    },

    async sendReply(pageId: string, token: string, recipientId: string, text: string, requestId?: string): Promise<string> {
      requirePageId(pageId);
      if (!graphId.safeParse(recipientId).success) throw new MetaGraphError("rejected");
      const payload = await request(`${pageId}/messages`, {
        method: "POST",
        token,
        body: JSON.stringify({
          recipient: { id: recipientId },
          messaging_type: "RESPONSE",
          message: { text, metadata: requestId },
        }),
      });
      return parseResponse(sendResponse, payload).message_id;
    },
  };
}
