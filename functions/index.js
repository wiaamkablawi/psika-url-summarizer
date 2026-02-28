const functions = require("firebase-functions");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const MAX_URL_LENGTH = 2048;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 40000;
const FETCH_TIMEOUT_MS = 15000;
const SUPREME_SEARCH_URL = "https://supreme.court.gov.il/Pages/fullsearch.aspx";

function setCorsHeaders(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) {
    return true;
  }

  if (parts[0] === 169 && parts[1] === 254) {
    return true;
  }

  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }

  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }

  return false;
}

function isBlockedHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized || normalized === "localhost" || normalized === "::1" || normalized === "[::1]") {
    return true;
  }

  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:")) {
    return true;
  }

  return isPrivateIpv4(normalized);
}

function decodeBasicEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function extractTextFromHtml(html) {
  const noScripts = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  const noStyles = noScripts.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  const withoutTags = noStyles.replace(/<[^>]+>/g, " ");
  return decodeBasicEntities(withoutTags).replace(/\s+/g, " ").trim();
}

async function readResponseBodyWithLimit(response) {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      throw createHttpError(413, "Response body too large (max 2 MB)");
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } catch (error) {
    if (error.name === "AbortError") {
      throw createHttpError(504, "Fetch timed out after 15 seconds");
    }
    throw createHttpError(502, `Fetch failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function writeSummaryDoc(data) {
  const docRef = await db.collection("summaries").add(data);
  return docRef.id;
}

async function runUrlIngest(url) {
  if (!url) throw createHttpError(400, "Missing 'url' in request body");
  if (url.length > MAX_URL_LENGTH) throw createHttpError(400, "URL too long (max 2048 chars)");

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw createHttpError(400, "Invalid URL");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw createHttpError(400, "Only http/https URLs are allowed");
  }
  if (isBlockedHostname(parsedUrl.hostname)) {
    throw createHttpError(400, "URL host is not allowed");
  }

  const normalizedUrl = parsedUrl.toString();
  const response = await fetchWithTimeout(normalizedUrl, {method: "GET", redirect: "follow"});

  if (!response.ok) throw createHttpError(502, `Upstream returned HTTP ${response.status}`);

  const contentTypeHeader = response.headers.get("content-type") || "";
  const contentType = contentTypeHeader.split(";")[0].trim().toLowerCase();
  if (!["text/html", "text/plain"].includes(contentType)) {
    throw createHttpError(415, `Unsupported content type: ${contentType || "unknown"}`);
  }

  const rawText = await readResponseBodyWithLimit(response);
  const extractedText = contentType === "text/html" ? extractTextFromHtml(rawText) : rawText;
  const text = extractedText.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);

  return {normalizedUrl, contentType, text};
}

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

async function runSupremePresetSearch() {
  // Best-effort: ASP.NET form fields vary, so we fill multiple common candidates.
  const landing = await fetchWithTimeout(SUPREME_SEARCH_URL, {method: "GET", redirect: "follow"});
  if (!landing.ok) {
    throw createHttpError(502, `Supreme search landing failed: ${landing.status}`);
  }

  const html = await readResponseBodyWithLimit(landing);
  const hidden = extractHiddenFields(html);

  const lastWeek = formatDateDdMmYyyy(7);
  const today = formatDateDdMmYyyy(0);

  const payload = new URLSearchParams({...hidden});
  const dateFromCandidates = [
    "ctl00$ContentPlaceHolder1$txtDateFrom",
    "ctl00$MainContent$txtDateFrom",
    "txtDateFrom",
  ];
  const dateToCandidates = [
    "ctl00$ContentPlaceHolder1$txtDateTo",
    "ctl00$MainContent$txtDateTo",
    "txtDateTo",
  ];
  const minPagesCandidates = [
    "ctl00$ContentPlaceHolder1$txtPagesFrom",
    "ctl00$MainContent$txtPagesFrom",
    "txtPagesFrom",
  ];
  const decisionTypeCandidates = [
    "ctl00$ContentPlaceHolder1$txtFreeText",
    "ctl00$MainContent$txtFreeText",
    "txtFreeText",
  ];
  const searchButtonCandidates = [
    "ctl00$ContentPlaceHolder1$btnSearch",
    "ctl00$MainContent$btnSearch",
    "btnSearch",
  ];

  for (const key of dateFromCandidates) payload.set(key, lastWeek);
  for (const key of dateToCandidates) payload.set(key, today);
  for (const key of minPagesCandidates) payload.set(key, "3");
  for (const key of decisionTypeCandidates) payload.set(key, "החלטה");
  for (const key of searchButtonCandidates) payload.set(key, "חפש");

  const resultRes = await fetchWithTimeout(SUPREME_SEARCH_URL, {
    method: "POST",
    redirect: "follow",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://supreme.court.gov.il",
      "Referer": SUPREME_SEARCH_URL,
    },
    body: payload.toString(),
  });

  if (!resultRes.ok) {
    throw createHttpError(502, `Supreme search request failed: ${resultRes.status}`);
  }

  const contentType = (resultRes.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!contentType.includes("text/html")) {
    throw createHttpError(415, `Unexpected response from supreme search: ${contentType || "unknown"}`);
  }

  const resultHtml = await readResponseBodyWithLimit(resultRes);
  const resultText = extractTextFromHtml(resultHtml).slice(0, MAX_TEXT_CHARS);

  if (!resultText) {
    throw createHttpError(502, "Supreme search returned empty results text");
  }

  return {
    sourceUrl: SUPREME_SEARCH_URL,
    contentType: "text/html",
    text: resultText,
    meta: {
      preset: "last_week_decisions_over_2_pages",
      dateFrom: lastWeek,
      dateTo: today,
      minPages: 3,
    },
  };
}

async function handleRequest(req, res, runner, sourceBuilder, options = {}) {
  const docWriter = options.writeSummaryDoc || writeSummaryDoc;
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ok: false, error: "Method not allowed"});

  console.log(`${runner.name} start`);

  try {
    const result = await runner(req.body || {});
    const doc = {
      source: sourceBuilder(result),
      status: "done",
      fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
      contentType: result.contentType,
      text: result.text,
    };
    if (result.meta) doc.meta = result.meta;

    const docId = await docWriter(doc);
    console.log(`${runner.name} complete`, {docId, status: "done"});
    return res.status(200).json({ok: true, id: docId, status: "done", chars: result.text.length});
  } catch (error) {
    const status = error.status || 500;
    const message = error.message || "Unexpected error";

    let docId = null;
    try {
      docId = await docWriter({
        source: {type: "url", url: req.body?.url || null},
        status: "failed",
        fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
        error: message,
      });
      console.log(`${runner.name} complete`, {docId, status: "failed", error: message});
    } catch (writeError) {
      console.error("Failed writing failed summary doc", writeError);
    }

    return res.status(status).json({ok: false, error: message, id: docId, status: "failed"});
  }
}

exports.createSummaryFromUrl = functions.https.onRequest((req, res) =>
  handleRequest(
    req,
    res,
    async (body) => runUrlIngest(typeof body.url === "string" ? body.url.trim() : ""),
    (result) => ({type: "url", url: result.normalizedUrl}),
  ),
);

exports.searchSupremeLastWeekDecisions = functions.https.onRequest((req, res) =>
  handleRequest(req, res, runSupremePresetSearch, (result) => ({
    type: "preset",
    provider: "supreme.court.gov.il",
    url: result.sourceUrl,
    preset: result.meta.preset,
  })),
);

if (process.env.NODE_ENV === "test") {
  exports.__test = {
    MAX_RESPONSE_BYTES,
    createHttpError,
    isBlockedHostname,
    extractTextFromHtml,
    readResponseBodyWithLimit,
    fetchWithTimeout,
    runUrlIngest,
    extractHiddenFields,
    runSupremePresetSearch,
    handleRequest,
  };
}
