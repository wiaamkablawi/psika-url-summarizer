const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT || "demo-psika";
const baseUrl = process.env.FUNCTIONS_EMULATOR_URL || `http://127.0.0.1:5001/${projectId}/us-central1`;

function shouldRun() {
  return process.env.RUN_EMULATOR_TESTS === "1";
}

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({projectId});
  }
  return admin.firestore();
}

async function requestJson(path, {method = "GET", payload} = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {"Content-Type": "application/json"},
    body: payload ? JSON.stringify(payload) : undefined,
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  return {status: response.status, body};
}

async function getSummaryDoc(id) {
  const snapshot = await getDb().collection("summaries").doc(id).get();
  assert.equal(snapshot.exists, true, `Expected Firestore doc summaries/${id} to exist`);
  return snapshot;
}

test("createSummaryFromUrl writes done summary document", {skip: !shouldRun(), timeout: 30000}, async () => {
  const {status, body} = await requestJson("/createSummaryFromUrl", {
    method: "POST",
    payload: {url: "https://example.com/"},
  });

  assert.equal(status, 200);
  assert.equal(body?.ok, true);
  assert.equal(body?.status, "done");
  assert.equal(typeof body?.id, "string");
  assert.equal(typeof body?.chars, "number");
  assert.equal(typeof body?.durationMs, "number");
  assert.ok(body.chars > 0);

  const snapshot = await getSummaryDoc(body.id);
  assert.equal(snapshot.get("status"), "done");
  assert.equal(snapshot.get("source.type"), "url");
  assert.equal(snapshot.get("source.url"), "https://example.com/");
  assert.equal(snapshot.get("contentType"), "text/html");
  assert.equal(typeof snapshot.get("text"), "string");
  assert.ok(snapshot.get("text").length > 0);
});

test("createSummaryFromUrl writes failed summary document", {skip: !shouldRun(), timeout: 30000}, async () => {
  const {status, body} = await requestJson("/createSummaryFromUrl", {
    method: "POST",
    payload: {url: "notaurl"},
  });

  assert.equal(status, 400);
  assert.equal(body?.ok, false);
  assert.equal(body?.status, "failed");
  assert.equal(typeof body?.id, "string");
  assert.equal(typeof body?.durationMs, "number");
  assert.match(body?.error || "", /Invalid URL/);

  const snapshot = await getSummaryDoc(body.id);
  assert.equal(snapshot.get("status"), "failed");
  assert.equal(snapshot.get("source.type"), "url");
  assert.equal(snapshot.get("source.url"), "notaurl");
  assert.match(snapshot.get("error"), /Invalid URL/);
});

test("listLatestSummaries returns recent docs", {skip: !shouldRun(), timeout: 30000}, async () => {
  const {status, body} = await requestJson("/listLatestSummaries?limit=5");

  assert.equal(status, 200);
  assert.equal(body?.ok, true);
  assert.equal(Array.isArray(body?.summaries), true);
  assert.ok(body.summaries.length >= 1);
  assert.equal(typeof body.summaries[0].id, "string");
  assert.equal(typeof body.durationMs, "number");
});

test("listLatestSummaries rejects non-GET", {skip: !shouldRun(), timeout: 30000}, async () => {
  const {status, body} = await requestJson("/listLatestSummaries", {
    method: "POST",
    payload: {},
  });

  assert.equal(status, 405);
  assert.equal(body?.ok, false);
});
