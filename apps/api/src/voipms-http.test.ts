import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { postVoipMsApi, VOIPMS_API_URL } from "./voipms-http.js";

describe("postVoipMsApi", () => {
  it("posts multipart/form-data without a manually-set content-type header", async () => {
    let request: { url: string; init?: RequestInit } | undefined;
    const result = await postVoipMsApi({ method: "getCDR", foo: "bar" }, async (input, init) => {
      request = { url: String(input), init };
      return Response.json({ status: "success" });
    });

    assert.equal(request!.url, VOIPMS_API_URL);
    assert.equal(request!.init?.method, "POST");
    const body = request!.init?.body as FormData;
    assert.ok(body instanceof FormData);
    assert.equal(body.get("method"), "getCDR");
    assert.equal(body.get("foo"), "bar");
    assert.equal(
      request!.init && "content-type" in (request!.init.headers as Record<string, string>),
      false,
    );
    assert.deepEqual(result, { ok: true, body: { status: "success" } });
  });

  it("classifies a network failure", async () => {
    const result = await postVoipMsApi({}, async () => {
      throw new Error("boom");
    });
    assert.deepEqual(result, { ok: false, failure: { kind: "network", error: "boom" } });
  });

  it("classifies a non-2xx response", async () => {
    const result = await postVoipMsApi(
      {},
      async () => new Response("server error", { status: 500 }),
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.failure.kind, "http");
      assert.equal((result.failure as { status: number }).status, 500);
    }
  });

  it("classifies an invalid JSON body", async () => {
    const result = await postVoipMsApi({}, async () => new Response("not json"));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.kind, "bad_json");
  });
});
