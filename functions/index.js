const functions = require("firebase-functions");

const SUPREME_COURT_SEARCH_URL = "https://supreme.court.gov.il/Pages/fullsearch.aspx";

function extractHiddenFields(html) {
  const hidden = {};
  const re = /<input[^>]*type=["']hidden["'][^>]*>/gi;
  const items = html.match(re) || [];

  for (const item of items) {
    const name = item.match(/name=["']([^"']+)["']/i)?.[1];
    const value = item.match(/value=["']([^"']*)["']/i)?.[1] || "";
    if (name) hidden[name] = value;
  }

  return hidden;
}

function formatDateDdMmYyyy(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

exports.health = functions.https.onRequest((_req, res) => {
  res.status(200).json({ok: true, message: "Project scaffold is ready for rebuild."});
});

exports.autoSupremeSearch = functions.https.onRequest(async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const landingRes = await fetch(SUPREME_COURT_SEARCH_URL, {method: "GET", redirect: "follow"});
    if (!landingRes.ok) {
      res.status(502).send(`Supreme landing failed with status ${landingRes.status}`);
      return;
    }

    const landingHtml = await landingRes.text();
    const hidden = extractHiddenFields(landingHtml);
    const payload = new URLSearchParams({...hidden});

    const lastWeek = formatDateDdMmYyyy(7);
    const today = formatDateDdMmYyyy(0);

    const dateFromCandidates = ["ctl00$ContentPlaceHolder1$txtDateFrom", "ctl00$MainContent$txtDateFrom", "txtDateFrom"];
    const dateToCandidates = ["ctl00$ContentPlaceHolder1$txtDateTo", "ctl00$MainContent$txtDateTo", "txtDateTo"];
    const minPagesCandidates = ["ctl00$ContentPlaceHolder1$txtPagesFrom", "ctl00$MainContent$txtPagesFrom", "txtPagesFrom"];

    const essentialOnlyCandidates = [
      "ctl00$ContentPlaceHolder1$ddlMahutiTechni",
      "ctl00$MainContent$ddlMahutiTechni",
      "ddlMahutiTechni",
    ];

    const sectionCandidates = [
      "ctl00$ContentPlaceHolder1$ddlSection",
      "ctl00$MainContent$ddlSection",
      "ddlSection",
      "ctl00$ContentPlaceHolder1$ddlMador",
      "ctl00$MainContent$ddlMador",
      "ddlMador",
    ];

    const searchButtonCandidates = ["ctl00$ContentPlaceHolder1$btnSearch", "ctl00$MainContent$btnSearch", "btnSearch"];

    for (const key of dateFromCandidates) payload.set(key, lastWeek);
    for (const key of dateToCandidates) payload.set(key, today);
    for (const key of minPagesCandidates) payload.set(key, "2");

    for (const key of essentialOnlyCandidates) {
      payload.set(key, "מהותיות בלבד");
    }

    for (const key of sectionCandidates) {
      payload.set(key, "פלילי");
    }

    for (const key of searchButtonCandidates) {
      payload.set(key, "חפש");
    }

    const searchRes = await fetch(SUPREME_COURT_SEARCH_URL, {
      method: "POST",
      redirect: "follow",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://supreme.court.gov.il",
        Referer: SUPREME_COURT_SEARCH_URL,
      },
      body: payload.toString(),
    });

    const resultHtml = await searchRes.text();
    res.set("Content-Type", "text/html; charset=utf-8");
    res.status(searchRes.ok ? 200 : 502).send(resultHtml);
  } catch (error) {
    console.error("autoSupremeSearch failed", error);
    res.status(500).send("Failed to run automated Supreme Court search.");
  }
});
