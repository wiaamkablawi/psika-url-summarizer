const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("./core");

function createResponse({ok = true, status = 200, contentType = "text/plain", chunks = []} = {}) {
  return {
    ok,
    status,
    headers: {
      get: (name) => (name.toLowerCase() === "content-type" ? contentType : null),
    },
    body: {
      getReader: () => {
        let i = 0;
        return {
          read: async () => {
            if (i >= chunks.length) return {done: true, value: undefined};
            return {done: false, value: chunks[i++]};
          },
        };
      },
    },
  };
}

function createMockRes() {
  const headers = {};
  return {
    headers,
    statusCode: null,
    body: undefined,
    set(name, value) {
      headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("isBlockedHostname blocks localhost/private networks", () => {
  assert.equal(core.isBlockedHostname("localhost"), true);
  assert.equal(core.isBlockedHostname("192.168.1.2"), true);
  assert.equal(core.isBlockedHostname("example.com"), false);
});

test("extractTextFromHtml strips scripts/tags and decodes entities", () => {
  const html = "<html><head><script>alert(1)</script></head><body><h1>Title</h1><p>A &amp; B</p></body></html>";
  assert.equal(core.extractTextFromHtml(html), "Title A & B");
});

test("runUrlIngest rejects empty URL", async () => {
  await assert.rejects(() => core.runUrlIngest(""), (error) => error.status === 400);
});

test("runUrlIngest rejects unsupported content type", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => createResponse({contentType: "application/pdf", chunks: [Buffer.from("x")]});
  try {
    await assert.rejects(() => core.runUrlIngest("https://example.com/file"), (error) => error.status === 415);
  } finally {
    global.fetch = originalFetch;
  }
});

test("runUrlIngest returns normalized URL and extracted text", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    createResponse({
      contentType: "text/html; charset=utf-8",
      chunks: [Buffer.from("<html><body>Hello <b>world</b></body></html>")],
    });
  try {
    const result = await core.runUrlIngest("https://example.com");
    assert.equal(result.normalizedUrl, "https://example.com/");
    assert.equal(result.contentType, "text/html");
    assert.equal(result.text, "Hello world");
  } finally {
    global.fetch = originalFetch;
  }
});

test("fetchWithTimeout maps AbortError to 504", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    const err = new Error("timeout");
    err.name = "AbortError";
    throw err;
  };
  try {
    await assert.rejects(() => core.fetchWithTimeout("https://example.com"), (error) => error.status === 504);
  } finally {
    global.fetch = originalFetch;
  }
});

test("handleRequest returns 204 for OPTIONS and sets CORS headers", async () => {
  const req = {method: "OPTIONS"};
  const res = createMockRes();

  await core.handleRequest(req, res, async () => ({}), () => ({}));

  assert.equal(res.statusCode, 204);
  assert.equal(res.body, "");
  assert.equal(res.headers["Access-Control-Allow-Origin"], "*");
});

test("handleRequest returns 405 for non-POST", async () => {
  const req = {method: "GET"};
  const res = createMockRes();

  await core.handleRequest(req, res, async () => ({}), () => ({}));

  assert.equal(res.statusCode, 405);
  assert.equal(res.body.ok, false);
});

test("handleRequest returns success payload and writes done document", async () => {
  const req = {method: "POST", body: {url: "https://example.com"}};
  const res = createMockRes();
  const docs = [];

  await core.handleRequest(
    req,
    res,
    async () => ({contentType: "text/plain", text: "abc"}),
    () => ({type: "url", url: "https://example.com"}),
    {
      writeSummaryDoc: async (doc) => {
        docs.push(doc);
        return "doc-123";
      },
    },
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.id, "doc-123");
  assert.equal(typeof res.body.durationMs, "number");
  assert.equal(docs[0].status, "done");
  assert.equal(typeof docs[0].durationMs, "number");
});

test("handleRequest writes failed document and returns error payload", async () => {
  const req = {method: "POST", body: {url: "https://bad.example"}};
  const res = createMockRes();
  const writes = [];

  await core.handleRequest(
    req,
    res,
    async () => {
      const err = new Error("boom");
      err.status = 502;
      throw err;
    },
    () => ({type: "url", url: "https://bad.example"}),
    {
      writeSummaryDoc: async (doc) => {
        writes.push(doc);
        return "failed-1";
      },
    },
  );

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.id, "failed-1");
  assert.equal(res.body.errorType, "Error");
  assert.equal(typeof res.body.durationMs, "number");
  assert.equal(writes[0].status, "failed");
  assert.equal(typeof writes[0].durationMs, "number");
});

test("readResponseBodyWithLimit rejects payloads larger than MAX_RESPONSE_BYTES", async () => {
  const tooLargeChunk = Buffer.alloc(core.MAX_RESPONSE_BYTES + 1, "a");
  const response = createResponse({chunks: [tooLargeChunk]});

  await assert.rejects(() => core.readResponseBodyWithLimit(response), (error) => error.status === 413);
});




test("parseListLimit enforces strict range and format", () => {
  assert.equal(core.parseListLimit(undefined), 20);
  assert.equal(core.parseListLimit("1"), 1);
  assert.equal(core.parseListLimit("50"), 50);
  assert.throws(() => core.parseListLimit("0"), /between 1 and 50/);
  assert.throws(() => core.parseListLimit("51"), /between 1 and 50/);
  assert.throws(() => core.parseListLimit("2.5"), /between 1 and 50/);
  assert.throws(() => core.parseListLimit("abc"), /between 1 and 50/);
  assert.throws(() => core.parseListLimit(["2", "3"]), /between 1 and 50/);
});

test("handleListSummariesRequest returns list payload for GET", async () => {
  const req = {method: "GET", query: {limit: "2"}};
  const res = createMockRes();

  await core.handleListSummariesRequest(req, res, {
    listSummaries: async (limit) => {
      assert.equal(limit, 2);
      return [{id: "a"}, {id: "b"}];
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.count, 2);
  assert.equal(typeof res.body.durationMs, "number");
});



test("handleListSummariesRequest OPTIONS advertises GET in CORS", async () => {
  const req = {method: "OPTIONS", query: {}};
  const res = createMockRes();

  await core.handleListSummariesRequest(req, res, {
    listSummaries: async () => [],
  });

  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["Access-Control-Allow-Methods"], "GET, OPTIONS");
});

test("handleListSummariesRequest validates method and config", async () => {
  const badMethodReq = {method: "POST", query: {}};
  const badMethodRes = createMockRes();
  await core.handleListSummariesRequest(badMethodReq, badMethodRes, {
    listSummaries: async () => [],
  });
  assert.equal(badMethodRes.statusCode, 405);

  const missingCfgReq = {method: "GET", query: {}};
  const missingCfgRes = createMockRes();
  await core.handleListSummariesRequest(missingCfgReq, missingCfgRes, {});
  assert.equal(missingCfgRes.statusCode, 500);
  assert.equal(missingCfgRes.body.ok, false);
});



test("handleListSummariesRequest returns 400 for invalid limit", async () => {
  const req = {method: "GET", query: {limit: "abc"}};
  const res = createMockRes();

  await core.handleListSummariesRequest(req, res, {listSummaries: async () => []});

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.errorType, "ValidationError");
  assert.equal(typeof res.body.durationMs, "number");
});

test("handleListSummariesRequest maps query failures", async () => {
  const req = {method: "GET", query: {limit: "4"}};
  const res = createMockRes();

  await core.handleListSummariesRequest(req, res, {
    listSummaries: async () => {
      throw core.createHttpError(503, "Firestore query failed", "FirestoreQueryError");
    },
  });

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.errorType, "FirestoreQueryError");
  assert.equal(typeof res.body.durationMs, "number");
});

test("runSupremePresetSearch returns extracted text and preset metadata", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({url, options});

    if (calls.length === 1) {
      return createResponse({
        contentType: "text/html; charset=utf-8",
        chunks: [Buffer.from('<input type="hidden" name="__VIEWSTATE" value="abc" />')],
      });
    }

    return createResponse({
      contentType: "text/html; charset=utf-8",
      chunks: [Buffer.from("<html><body>תוצאת החלטה</body></html>")],
    });
  };

  try {
    const result = await core.runSupremePresetSearch();

    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[1].options.method, "POST");
    assert.match(calls[1].options.body, /__VIEWSTATE=abc/);
    assert.equal(result.contentType, "text/html");
    assert.equal(result.meta.preset, "last_week_decisions_over_2_pages");
    assert.equal(result.text.includes("תוצאת החלטה"), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("runSupremePresetSearch rejects non-html result response", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (options.method === "POST") {
      return createResponse({contentType: "application/json", chunks: [Buffer.from('{"ok":true}')]});
    }
    return createResponse({
      contentType: "text/html; charset=utf-8",
      chunks: [Buffer.from('<input type="hidden" name="__VIEWSTATE" value="abc" />')],
    });
  };

  try {
    await assert.rejects(() => core.runSupremePresetSearch(), (error) => error.status === 415);
  } finally {
    global.fetch = originalFetch;
  }
});


test("handleRequest uses failureSourceBuilder for failed documents", async () => {
  const req = {method: "POST", body: {foo: "bar"}};
  const res = createMockRes();
  const writes = [];

  await core.handleRequest(
    req,
    res,
    async () => {
      throw core.createHttpError(502, "upstream failed");
    },
    () => ({type: "url", url: "https://example.com"}),
    {
      writeSummaryDoc: async (doc) => {
        writes.push(doc);
        return "failed-custom-source";
      },
      failureSourceBuilder: () => ({
        type: "preset",
        provider: "supreme.court.gov.il",
        preset: "last_week_decisions_over_2_pages",
      }),
    },
  );

  assert.equal(res.statusCode, 502);
  assert.equal(writes[0].source.type, "preset");
  assert.equal(writes[0].source.provider, "supreme.court.gov.il");
  assert.equal(typeof writes[0].durationMs, "number");
});

test("handleRequest falls back to URL source when failureSourceBuilder throws", async () => {
  const req = {method: "POST", body: {url: "https://fallback.example"}};
  const res = createMockRes();
  const writes = [];

  await core.handleRequest(
    req,
    res,
    async () => {
      throw core.createHttpError(500, "boom");
    },
    () => ({type: "url", url: "https://fallback.example"}),
    {
      writeSummaryDoc: async (doc) => {
        writes.push(doc);
        return "failed-fallback-source";
      },
      failureSourceBuilder: () => {
        throw new Error("source builder crashed");
      },
    },
  );

  assert.equal(res.statusCode, 500);
  assert.equal(writes[0].source.type, "url");
  assert.equal(writes[0].source.url, "https://fallback.example");
  assert.equal(typeof writes[0].durationMs, "number");
});

test("handleRequest returns 500 when writeSummaryDoc is missing", async () => {
  const req = {method: "POST", body: {url: "https://example.com"}};
  const res = createMockRes();

  await core.handleRequest(
    req,
    res,
    async () => ({contentType: "text/plain", text: "abc"}),
    () => ({type: "url", url: "https://example.com"}),
  );

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.id, null);
  assert.equal(res.body.status, "failed");
  assert.equal(typeof res.body.durationMs, "undefined");
  assert.match(res.body.error, /writeSummaryDoc missing/);
});
