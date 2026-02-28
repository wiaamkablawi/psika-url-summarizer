const test = require("node:test");
const assert = require("node:assert/strict");

const {__test} = require("./index");

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
  assert.equal(__test.isBlockedHostname("localhost"), true);
  assert.equal(__test.isBlockedHostname("192.168.1.2"), true);
  assert.equal(__test.isBlockedHostname("example.com"), false);
});

test("extractTextFromHtml strips scripts/tags and decodes entities", () => {
  const html = "<html><head><script>alert(1)</script></head><body><h1>Title</h1><p>A &amp; B</p></body></html>";
  assert.equal(__test.extractTextFromHtml(html), "Title A & B");
});

test("runUrlIngest rejects empty URL", async () => {
  await assert.rejects(() => __test.runUrlIngest(""), (error) => error.status === 400);
});

test("runUrlIngest rejects unsupported content type", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => createResponse({contentType: "application/pdf", chunks: [Buffer.from("x")]});
  try {
    await assert.rejects(() => __test.runUrlIngest("https://example.com/file"), (error) => error.status === 415);
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
    const result = await __test.runUrlIngest("https://example.com");
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
    await assert.rejects(() => __test.fetchWithTimeout("https://example.com"), (error) => error.status === 504);
  } finally {
    global.fetch = originalFetch;
  }
});

test("handleRequest returns 204 for OPTIONS and sets CORS headers", async () => {
  const req = {method: "OPTIONS"};
  const res = createMockRes();

  await __test.handleRequest(req, res, async () => ({}), () => ({}));

  assert.equal(res.statusCode, 204);
  assert.equal(res.body, "");
  assert.equal(res.headers["Access-Control-Allow-Origin"], "*");
});

test("handleRequest returns 405 for non-POST", async () => {
  const req = {method: "GET"};
  const res = createMockRes();

  await __test.handleRequest(req, res, async () => ({}), () => ({}));

  assert.equal(res.statusCode, 405);
  assert.equal(res.body.ok, false);
});

test("handleRequest returns success payload and writes done document", async () => {
  const req = {method: "POST", body: {url: "https://example.com"}};
  const res = createMockRes();
  const docs = [];

  await __test.handleRequest(
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
  assert.equal(docs[0].status, "done");
});

test("handleRequest writes failed document and returns error payload", async () => {
  const req = {method: "POST", body: {url: "https://bad.example"}};
  const res = createMockRes();
  const writes = [];

  await __test.handleRequest(
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
  assert.equal(writes[0].status, "failed");
});

test("readResponseBodyWithLimit rejects payloads larger than MAX_RESPONSE_BYTES", async () => {
  const tooLargeChunk = Buffer.alloc(__test.MAX_RESPONSE_BYTES + 1, "a");
  const response = createResponse({chunks: [tooLargeChunk]});

  await assert.rejects(() => __test.readResponseBodyWithLimit(response), (error) => error.status === 413);
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
    const result = await __test.runSupremePresetSearch();

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
    await assert.rejects(() => __test.runSupremePresetSearch(), (error) => error.status === 415);
  } finally {
    global.fetch = originalFetch;
  }
});
