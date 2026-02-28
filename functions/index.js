const functions = require("firebase-functions");
const admin = require("firebase-admin");
const core = require("./core");
const {createSummaryWriter} = require("./writers/summaryWriter");
const {createListLatestSummariesQuery} = require("./queries/listLatestSummaries");
const {createSupremeSearchRunner} = require("./services/supremeSearchRunner");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const writeSummaryDoc = createSummaryWriter(db);
const listLatestSummaries = createListLatestSummariesQuery(db, core.createHttpError);
const runSupremeSearch = createSupremeSearchRunner(core);

exports.createSummaryFromUrl = functions.https.onRequest((req, res) =>
  core.handleRequest(
    req,
    res,
    async (body) => core.runUrlIngest(typeof body.url === "string" ? body.url.trim() : ""),
    (result) => ({type: "url", url: result.normalizedUrl}),
    {
      endpointName: "createSummaryFromUrl",
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
    runSupremeSearch,
    (result) => ({
      type: "preset",
      provider: "supreme.court.gov.il",
      url: result.sourceUrl,
      preset: result.meta.preset,
    }),
    {
      endpointName: "searchSupremeLastWeekDecisions",
      writeSummaryDoc,
      failureSourceBuilder: () => ({
        type: "preset",
        provider: "supreme.court.gov.il",
        url: core.SUPREME_SEARCH_URL,
        preset: "last_week_material_only_criminal_over_2_pages",
      }),
    },
  ),
);

exports.listLatestSummaries = functions.https.onRequest((req, res) =>
  core.handleListSummariesRequest(req, res, {endpointName: "listLatestSummaries", listSummaries: listLatestSummaries}),
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
