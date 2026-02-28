const admin = require("firebase-admin");

const MAX_URL_LENGTH = 2048;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 40000;
const FETCH_TIMEOUT_MS = 15000;
const SUPREME_SEARCH_URL = "https://supreme.court.gov.il/Pages/fullsearch.aspx";

function setCorsHeaders(res, allowedMethods = "POST, OPTIONS") {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", allowedMethods);
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function createHttpError(status, message, errorType) {
  const error = new Error(message);
  error.status = status;
  if (errorType) error.errorType = errorType;
  return error;
}

function classifyError(error) {
  if (!error) return "UnknownError";
  return error.errorType || error.name || "Error";
}

function logEndpointEvent(level, data) {
  const logPayload = {
    endpoint: data.endpoint || "unknown",
    status: data.status || "unknown",
    durationMs: typeof data.durationMs === "number" ? data.durationMs : null,
    errorType: data.errorType || null,
    ...data,
  };

  if (level === "error") {
    console.error("endpoint_event", logPayload);
    return;
  }
  console.log("endpoint_event", logPayload);
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
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
      throw createHttpError(413, "Response body too large (max 2 MB)", "ResponseTooLarge");
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
      throw createHttpError(504, "Fetch timed out after 15 seconds", "FetchTimeout");
    }
    throw createHttpError(502, `Fetch failed: ${error.message}`, "FetchError");
  } finally {
    clearTimeout(timeout);
  }
}

async function runUrlIngest(url) {
  if (!url) throw createHttpError(400, "Missing 'url' in request body", "ValidationError");
  if (url.length > MAX_URL_LENGTH) throw createHttpError(400, "URL too long (max 2048 chars)", "ValidationError");

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw createHttpError(400, "Invalid URL", "ValidationError");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw createHttpError(400, "Only http/https URLs are allowed", "ValidationError");
  }
  if (isBlockedHostname(parsedUrl.hostname)) {
    throw createHttpError(400, "URL host is not allowed", "ValidationError");
  }

  const normalizedUrl = parsedUrl.toString();
  const response = await fetchWithTimeout(normalizedUrl, {method: "GET", redirect: "follow"});
  if (!response.ok) throw createHttpError(502, `Upstream returned HTTP ${response.status}`, "UpstreamHttpError");

  const contentTypeHeader = response.headers.get("content-type") || "";
  const contentType = contentTypeHeader.split(";")[0].trim().toLowerCase();
  if (!["text/html", "text/plain"].includes(contentType)) {
    throw createHttpError(415, `Unsupported content type: ${contentType || "unknown"}`, "UnsupportedContentType");
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
  const landing = await fetchWithTimeout(SUPREME_SEARCH_URL, {method: "GET", redirect: "follow"});
  if (!landing.ok) {
    throw createHttpError(502, `Supreme search landing failed: ${landing.status}`, "SupremeLandingError");
  }

  const html = await readResponseBodyWithLimit(landing);
  const hidden = extractHiddenFields(html);

  const lastWeek = formatDateDdMmYyyy(7);
  const today = formatDateDdMmYyyy(0);

  const payload = new URLSearchParams({...hidden});
  const dateFromCandidates = ["ctl00$ContentPlaceHolder1$txtDateFrom", "ctl00$MainContent$txtDateFrom", "txtDateFrom"];
  const dateToCandidates = ["ctl00$ContentPlaceHolder1$txtDateTo", "ctl00$MainContent$txtDateTo", "txtDateTo"];
  const minPagesCandidates = ["ctl00$ContentPlaceHolder1$txtPagesFrom", "ctl00$MainContent$txtPagesFrom", "txtPagesFrom"];
  const decisionTypeCandidates = ["ctl00$ContentPlaceHolder1$txtFreeText", "ctl00$MainContent$txtFreeText", "txtFreeText"];
  const searchButtonCandidates = ["ctl00$ContentPlaceHolder1$btnSearch", "ctl00$MainContent$btnSearch", "btnSearch"];

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
      Origin: "https://supreme.court.gov.il",
      Referer: SUPREME_SEARCH_URL,
    },
    body: payload.toString(),
  });

  if (!resultRes.ok) {
    throw createHttpError(502, `Supreme search request failed: ${resultRes.status}`, "SupremeSearchError");
  }

  const contentType = (resultRes.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!contentType.includes("text/html")) {
    throw createHttpError(415, `Unexpected response from supreme search: ${contentType || "unknown"}`, "UnsupportedContentType");
  }

  const resultHtml = await readResponseBodyWithLimit(resultRes);
  const resultText = extractTextFromHtml(resultHtml).slice(0, MAX_TEXT_CHARS);

  if (!resultText) {
    throw createHttpError(502, "Supreme search returned empty results text", "SupremeEmptyResult");
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

function parseListLimit(rawLimit) {
  if (typeof rawLimit === "undefined") return 20;
  if (Array.isArray(rawLimit)) {
    throw createHttpError(400, "Query 'limit' must be a single integer between 1 and 50", "ValidationError");
  }
  const normalized = String(rawLimit).trim();
  if (!/^\d+$/.test(normalized)) {
    throw createHttpError(400, "Query 'limit' must be a single integer between 1 and 50", "ValidationError");
  }

  const limit = Number(normalized);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw createHttpError(400, "Query 'limit' must be a single integer between 1 and 50", "ValidationError");
  }
  return limit;
}

async function handleRequest(req, res, runner, sourceBuilder, options = {}) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ok: false, error: "Method not allowed"});

  const endpoint = options.endpointName || req.path || req.url || "unknown";
  const docWriter = options.writeSummaryDoc;
  const startedAtMs = Date.now();

  if (typeof docWriter !== "function") {
    logEndpointEvent("error", {
      endpoint,
      status: "failed",
      errorType: "MisconfigurationError",
      message: "Server misconfiguration: writeSummaryDoc missing",
    });
    return res.status(500).json({
      ok: false,
      error: "Server misconfiguration: writeSummaryDoc missing",
      errorType: "MisconfigurationError",
      id: null,
      status: "failed",
      durationMs: Date.now() - startedAtMs,
    });
  }

  logEndpointEvent("info", {endpoint, status: "started"});

  try {
    const result = await runner(req.body || {});
    const durationMs = Date.now() - startedAtMs;
    const doc = {
      source: sourceBuilder(result),
      status: "done",
      fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
      contentType: result.contentType,
      text: result.text,
      durationMs,
    };
    if (result.meta) doc.meta = result.meta;

    const docId = await docWriter(doc);
    logEndpointEvent("info", {endpoint, status: "done", durationMs, errorType: null, docId});
    return res.status(200).json({ok: true, id: docId, status: "done", chars: result.text.length, durationMs});
  } catch (error) {
    const status = error.status || 500;
    const message = error.message || "Unexpected error";
    const errorType = classifyError(error);
    const durationMs = Date.now() - startedAtMs;

    let failureSource = {type: "url", url: req.body?.url || null};
    if (typeof options.failureSourceBuilder === "function") {
      try {
        const builtSource = options.failureSourceBuilder(req);
        if (builtSource && typeof builtSource === "object") {
          failureSource = builtSource;
        }
      } catch (sourceError) {
        logEndpointEvent("error", {
          endpoint,
          status: "failed",
          errorType: classifyError(sourceError),
          durationMs,
          message: "Failed building failure source",
        });
      }
    }

    let docId = null;
    try {
      docId = await docWriter({
        source: failureSource,
        status: "failed",
        fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
        error: message,
        errorType,
        durationMs,
      });
    } catch (writeError) {
      logEndpointEvent("error", {
        endpoint,
        status: "failed",
        errorType: classifyError(writeError),
        durationMs,
        message: "Failed writing failed summary doc",
      });
    }

    logEndpointEvent("error", {endpoint, status: "failed", durationMs, errorType, error: message, docId});
    return res.status(status).json({ok: false, error: message, errorType, id: docId, status: "failed", durationMs});
  }
}

async function handleListSummariesRequest(req, res, options = {}) {
  setCorsHeaders(res, "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ok: false, error: "Method not allowed"});

  const endpoint = options.endpointName || req.path || req.url || "unknown";
  const listSummaries = options.listSummaries;
  const startedAtMs = Date.now();

  if (typeof listSummaries !== "function") {
    logEndpointEvent("error", {
      endpoint,
      status: "failed",
      errorType: "MisconfigurationError",
      message: "Server misconfiguration: listSummaries missing",
    });
    return res.status(500).json({
      ok: false,
      error: "Server misconfiguration: listSummaries missing",
      errorType: "MisconfigurationError",
      durationMs: Date.now() - startedAtMs,
    });
  }

  try {
    const safeLimit = parseListLimit(req.query?.limit);
    const summaries = await listSummaries(safeLimit);
    const durationMs = Date.now() - startedAtMs;
    logEndpointEvent("info", {endpoint, status: "done", durationMs, errorType: null, limit: safeLimit, count: summaries.length});
    return res.status(200).json({ok: true, count: summaries.length, summaries, durationMs});
  } catch (error) {
    const durationMs = Date.now() - startedAtMs;
    const status = error.status || 500;
    const errorType = classifyError(error);
    const message = error.message || "Unexpected error";
    logEndpointEvent("error", {endpoint, status: "failed", durationMs, errorType, error: message});
    return res.status(status).json({ok: false, error: message, errorType, durationMs});
  }
}

module.exports = {
  MAX_RESPONSE_BYTES,
  SUPREME_SEARCH_URL,
  setCorsHeaders,
  createHttpError,
  classifyError,
  logEndpointEvent,
  isBlockedHostname,
  extractTextFromHtml,
  readResponseBodyWithLimit,
  fetchWithTimeout,
  runUrlIngest,
  extractHiddenFields,
  runSupremePresetSearch,
  parseListLimit,
  handleRequest,
  handleListSummariesRequest,
};
