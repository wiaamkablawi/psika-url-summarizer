function createSupremeSearchRunner(core) {
  return async function runSupremeSearch(body = {}) {
    if (process.env.NODE_ENV === "test" && body.__forceFailure === true) {
      throw core.createHttpError(502, "Forced supreme search failure for integration test", "ForcedFailure");
    }

    if (process.env.NODE_ENV === "test" && body.__forceSuccess === true) {
      return {
        sourceUrl: core.SUPREME_SEARCH_URL,
        contentType: "text/html",
        text: "Synthetic supreme search result for emulator integration test",
        meta: {
          preset: "last_week_material_only_criminal_over_2_pages",
          dateFrom: "01/01/2025",
          dateTo: "08/01/2025",
          minPages: 2,
          materiality: "מהותיות בלבד",
          section: "פלילי",
        },
      };
    }

    return core.runSupremePresetSearch();
  };
}

module.exports = {createSupremeSearchRunner};
