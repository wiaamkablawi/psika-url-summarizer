function createSummaryWriter(db) {
  return async function writeSummaryDoc(data) {
    const docRef = await db.collection("summaries").add(data);
    return docRef.id;
  };
}

module.exports = {createSummaryWriter};
