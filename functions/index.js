const functions = require("firebase-functions");

exports.health = functions.https.onRequest((_req, res) => {
  res.status(200).json({ok: true, message: "Project scaffold is ready for rebuild."});
});
