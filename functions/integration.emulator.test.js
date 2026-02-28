const test = require("node:test");
const assert = require("node:assert/strict");
const admin = require("firebase-admin");

const projectId = process.env.FIREBASE_PROJECT || "demo-psika";
const baseUrl =
  process.env.FUNCTIONS_EMULATOR_URL ||
  `http://127.0.0.1:5001/${projectId}/us-central1`;

function shouldRun() {
  return process.env.RUN_EMULATOR_TESTS === "1";
}

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({projectId});
  }
  return admin.firestore();
}

async function postJson(path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  return {status: response.status, body};
}

test("createSummaryFromUrl writes done summary document", {skip: !shouldRun()}, async () => {
  const {status, body} = await postJson("/createSummaryFromUrl", {
    url: "https://example.com",
  });

  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.id, "string");

  const snapshot = await getDb().collection("summaries").doc(body.id).get();
  assert.equal(snapshot.exists, true);
  assert.equal(snapshot.get("status"), "done");
  assert.equal(snapshot.get("source.type"), "url");
});

test("createSummaryFromUrl writes failed summary document", {skip: !shouldRun()}, async () => {
  const {status, body} = await postJson("/createSummaryFromUrl", {
    url: "notaurl",
  });

  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.equal(typeof body.id, "string");

  const snapshot = await getDb().collection("summaries").doc(body.id).get();
  assert.equal(snapshot.exists, true);
  assert.equal(snapshot.get("status"), "failed");
  assert.match(snapshot.get("error"), /Invalid URL/);
});
