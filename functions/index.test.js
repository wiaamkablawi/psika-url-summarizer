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
