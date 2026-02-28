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


async function listLatestSummaries(limit) {
  const snapshot = await db.collection("summaries").orderBy("fetchedAt", "desc").limit(limit).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      status: data.status || null,
      source: data.source || null,
      contentType: data.contentType || null,
      error: data.error || null,
      chars: typeof data.text === "string" ? data.text.length : 0,
      durationMs: typeof data.durationMs === "number" ? data.durationMs : null,
      fetchedAt: data.fetchedAt ? data.fetchedAt.toDate().toISOString() : null,
    };
  });
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


exports.listLatestSummaries = functions.https.onRequest((req, res) =>
  core.handleListSummariesRequest(req, res, {listSummaries: listLatestSummaries}),
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
    handleListSummariesRequest: core.handleListSummariesRequest,
  };
}
