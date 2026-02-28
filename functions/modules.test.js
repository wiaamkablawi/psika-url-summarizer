const test = require("node:test");
const assert = require("node:assert/strict");

const {createListLatestSummariesQuery} = require("./queries/listLatestSummaries");
const {createSupremeSearchRunner} = require("./services/supremeSearchRunner");

test("createListLatestSummariesQuery maps Firestore failures to HttpError", async () => {
  const db = {
    collection: () => ({
      orderBy: () => ({
        limit: () => ({
          get: async () => {
            throw new Error("firestore unavailable");
          },
        }),
      }),
    }),
  };

  const listLatest = createListLatestSummariesQuery(db, (status, message, errorType) => {
    const error = new Error(message);
    error.status = status;
    error.errorType = errorType;
    return error;
  });

  await assert.rejects(() => listLatest(5), (error) => error.status === 503 && error.errorType === "FirestoreQueryError");
});

test("createSupremeSearchRunner supports test-mode force success/failure", async () => {
  const core = {
    SUPREME_SEARCH_URL: "https://example.test/supreme",
    createHttpError: (status, message, errorType) => {
      const error = new Error(message);
      error.status = status;
      error.errorType = errorType;
      return error;
    },
    runSupremePresetSearch: async () => ({text: "real"}),
  };

  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const runner = createSupremeSearchRunner(core);

  const success = await runner({__forceSuccess: true});
  assert.equal(success.sourceUrl, core.SUPREME_SEARCH_URL);
  assert.equal(success.meta.preset, "last_week_material_only_criminal_over_2_pages");

  await assert.rejects(() => runner({__forceFailure: true}), (error) => error.errorType === "ForcedFailure");

  process.env.NODE_ENV = previousNodeEnv;
});
