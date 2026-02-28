const functions = require("firebase-functions");
const admin = require("firebase-admin");
const core = require("./core");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

async function writeSummaryDoc(data) {
  const docRef = await db.collection("summaries").add(data);
  return docRef.id;
}

exports.createSummaryFromUrl = functions.https.onRequest((req, res) =>
  core.handleRequest(
    req,
    res,
    async (body) => core.runUrlIngest(typeof body.url === "string" ? body.url.trim() : ""),
    (result) => ({type: "url", url: result.normalizedUrl}),
    {writeSummaryDoc},
  ),
);

exports.searchSupremeLastWeekDecisions = functions.https.onRequest((req, res) =>
  core.handleRequest(
    req,
    res,
    core.runSupremePresetSearch,
    (result) => ({
      type: "preset",
      provider: "supreme.court.gov.il",
      url: result.sourceUrl,
      preset: result.meta.preset,
    }),
    {writeSummaryDoc},
  ),
);
