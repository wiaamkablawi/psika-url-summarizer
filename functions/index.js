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
    {
      writeSummaryDoc,
      failureSourceBuilder: (request) => ({
        type: "url",
        url: typeof request?.body?.url === "string" ? request.body.url.trim() : null,
      }),
    },
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
    {
      writeSummaryDoc,
      failureSourceBuilder: () => ({
        type: "preset",
        provider: "supreme.court.gov.il",
        url: core.SUPREME_SEARCH_URL,
        preset: "last_week_decisions_over_2_pages",
      }),
    },
  ),
);

if (process.env.NODE_ENV === "test") {
  exports.__test = {
    MAX_RESPONSE_BYTES: core.MAX_RESPONSE_BYTES,
    createHttpError: core.createHttpError,
    isBlockedHostname: core.isBlockedHostname,
    extractTextFromHtml: core.extractTextFromHtml,
    readResponseBodyWithLimit: core.readResponseBodyWithLimit,
    fetchWithTimeout: core.fetchWithTimeout,
    runUrlIngest: core.runUrlIngest,
    extractHiddenFields: core.extractHiddenFields,
    runSupremePresetSearch: core.runSupremePresetSearch,
    handleRequest: core.handleRequest,
  };
}
