function mapSummaryDoc(doc) {
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
}

function createListLatestSummariesQuery(db, createHttpError) {
  return async function listLatestSummaries(limit) {
    try {
      const snapshot = await db.collection("summaries").orderBy("fetchedAt", "desc").limit(limit).get();
      return snapshot.docs.map(mapSummaryDoc);
    } catch (error) {
      const message = error?.message || "Unknown Firestore error";
      throw createHttpError(503, `Firestore query failed: ${message}`, "FirestoreQueryError");
    }
  };
}

module.exports = {createListLatestSummariesQuery, mapSummaryDoc};
