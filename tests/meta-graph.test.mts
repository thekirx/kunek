import assert from "node:assert/strict";
import test from "node:test";
import { createMetaGraph, MetaGraphError } from "../src/lib/meta/graph.ts";

const exchange = {
  appId: "1234",
  appSecret: "test-app-secret",
  redirectUri: "https://oniro.example/api/meta/oauth/callback",
  code: "code+with&specials",
};

test("exchanges the OAuth code and exact redirect URI on the Graph host", async () => {
  const graph = createMetaGraph("v26.0", async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(request.method, "GET");
    assert.equal(request.redirect, "error");
    assert.equal(request.cache, "no-store");
    assert.equal(url.origin, "https://graph.facebook.com");
    assert.equal(url.pathname, "/v26.0/oauth/access_token");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      client_id: exchange.appId,
      client_secret: exchange.appSecret,
      redirect_uri: exchange.redirectUri,
      code: exchange.code,
    });
    return Response.json({ access_token: "user-token", token_type: "bearer", expires_in: 5100 });
  });

  assert.equal(await graph.exchangeCode(exchange), "user-token");
});

test("lists Pages across bounded cursor-based Graph requests without following the next URL", async () => {
  const afters: (string | null)[] = [];
  const graph = createMetaGraph("v26.0", async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, "https://graph.facebook.com");
    assert.equal(url.pathname, "/v26.0/me/accounts");
    assert.equal(url.searchParams.get("fields"), "id,name,access_token");
    assert.equal(url.searchParams.has("access_token"), false);
    assert.equal(request.headers.get("Authorization"), "Bearer user-token");
    const after = url.searchParams.get("after");
    afters.push(after);
    if (after === null) {
      return Response.json({
        data: [{ id: "42", name: "First Page", access_token: "first-page-token" }],
        paging: { cursors: { before: "first", after: "end+of/first=" }, next: "https://untrusted.example/" },
      });
    }
    assert.equal(after, "end+of/first=");
    return Response.json({
      data: [{ id: "43", name: "Second Page", access_token: "second-page-token" }],
      paging: { cursors: { before: "second", after: "final-page" } },
    });
  });

  assert.deepEqual(await graph.pages("user-token"), [
    { id: "42", name: "First Page", accessToken: "first-page-token" },
    { id: "43", name: "Second Page", accessToken: "second-page-token" },
  ]);
  assert.deepEqual(afters, [null, "end+of/first="]);
});

test("rejects a repeated Page cursor instead of returning incomplete results", async () => {
  let requests = 0;
  const graph = createMetaGraph("v26.0", async () => {
    requests += 1;
    return Response.json({ data: [], paging: { cursors: { after: "repeat" }, next: "https://graph.facebook.com/" } });
  });

  await assert.rejects(graph.pages("user-token"), { name: "MetaGraphError", kind: "ambiguous" });
  assert.equal(requests, 2);
});

test("checks the Page token's own identity before using it for a connection", async () => {
  const graph = createMetaGraph("v26.0", async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, "https://graph.facebook.com/v26.0/me?fields=id");
    assert.equal(request.headers.get("Authorization"), "Bearer page-token");
    return Response.json({ id: "42" });
  });

  await graph.verifyPage("42", "page-token");
  await assert.rejects(graph.verifyPage("43", "page-token"), { name: "MetaGraphError", kind: "auth" });
});

test("subscribes with the Page token and deletes the subscription with the app token", async () => {
  const methods: string[] = [];
  const graph = createMetaGraph("v26.0", async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.pathname, "/v26.0/42/subscribed_apps");
    assert.equal(url.searchParams.has("access_token"), false);
    if (request.method === "POST") {
      assert.equal(request.headers.get("Authorization"), "Bearer page-token");
      assert.equal((await request.formData()).get("subscribed_fields"), "messages,message_echoes,message_deliveries,message_reads");
    } else {
      assert.equal(request.headers.get("Authorization"), "Bearer 1234|test-app-secret");
    }
    methods.push(request.method);
    return Response.json({ success: true });
  });

  await graph.subscribe("42", "page-token");
  await graph.unsubscribe("42", "1234|test-app-secret");
  assert.deepEqual(methods, ["POST", "DELETE"]);
});

test("does not confirm a disconnect when Meta reports a failed Messenger removal", async () => {
  const graph = createMetaGraph("v26.0", async () => Response.json({
    success: true,
    messaging_success: false,
  }));

  await assert.rejects(graph.unsubscribe("42", "1234|test-app-secret"), {
    name: "MetaGraphError", kind: "ambiguous",
  });
});

test("sends a Messenger RESPONSE and returns Meta's message ID", async () => {
  const graph = createMetaGraph("v26.0", async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.method, "POST");
    assert.equal(request.url, "https://graph.facebook.com/v26.0/42/messages");
    assert.equal(request.headers.get("Authorization"), "Bearer page-token");
    assert.ok(request.signal instanceof AbortSignal);
    assert.deepEqual(await request.json(), {
      recipient: { id: "56" },
      messaging_type: "RESPONSE",
      message: { text: "Hello!" },
    });
    return Response.json({ recipient_id: "56", message_id: "m_reply_123" });
  });

  assert.equal(await graph.sendReply("42", "page-token", "56", "Hello!"), "m_reply_123");
});

test("includes an outgoing request ID as custom metadata for the echo", async () => {
  const requestId = "5ec16e37-7b39-4016-854f-c2002b939387";
  const graph = createMetaGraph("v26.0", async (input, init) => {
    const request = new Request(input, init);
    assert.deepEqual(await request.json(), {
      recipient: { id: "56" },
      messaging_type: "RESPONSE",
      message: { text: "Hello!", metadata: requestId },
    });
    return Response.json({ recipient_id: "56", message_id: "m_reply_123" });
  });

  assert.equal(await graph.sendReply("42", "page-token", "56", "Hello!", requestId), "m_reply_123");
});

const graphFailures = [
  { status: 400, error: { code: 190, error_subcode: 463 }, kind: "auth" },
  { status: 403, error: { code: 200 }, kind: "auth" },
  { status: 400, error: { code: 100 }, kind: "rejected" },
  { status: 400, error: { code: 100, is_transient: true }, kind: "ambiguous" },
  { status: 500, error: { code: 2 }, kind: "ambiguous" },
  { status: 200, error: { code: 100 }, kind: "ambiguous" },
];

for (const { status, error, kind } of graphFailures) {
  test(`classifies a Graph HTTP ${status} error ${JSON.stringify(error)} as ${kind}`, async () => {
    const graph = createMetaGraph("v26.0", async () =>
      Response.json({ error: { ...error, message: "provider detail containing page-token" } }, { status }),
    );
    await assert.rejects(graph.sendReply("42", "page-token", "56", "Hello!"), (failure: unknown) => {
      assert.ok(failure instanceof MetaGraphError);
      assert.equal(failure.kind, kind);
      assert.doesNotMatch(String(failure), /provider detail|page-token/);
      assert.equal(failure.cause, undefined);
      return true;
    });
  });
}

test("preserves ambiguous send outcomes after a fetch error or missing message ID", async () => {
  const networkFailure = createMetaGraph("v26.0", async () => { throw new Error("page-token"); });
  const missingId = createMetaGraph("v26.0", async () => Response.json({ recipient_id: "56" }));
  for (const graph of [networkFailure, missingId]) {
    await assert.rejects(graph.sendReply("42", "page-token", "56", "Hello!"), {
      name: "MetaGraphError", kind: "ambiguous",
    });
  }
});

test("requests only customer names with a Page credential", async () => {
  const mock: typeof fetch = async (url, options) => {
    assert.equal(new URL(String(url)).pathname.split("/").at(-1), "456");
    assert.equal(new URL(String(url)).searchParams.get("fields"), "first_name,last_name");
    assert.equal(new Headers(options?.headers).get("authorization"), "Bearer fixture-page-token");
    return Response.json({ first_name: "Rosa", last_name: "Santos" });
  };
  assert.equal(await createMetaGraph("v27.0", mock).profileName("456", "fixture-page-token"), "Rosa Santos");
});
