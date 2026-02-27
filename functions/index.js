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
  if (!normalized) {
    return true;
  }

  if (normalized === "localhost") {
    return true;
  }

  if (normalized === "::1" || normalized === "[::1]") {
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
  const decoded = decodeBasicEntities(withoutTags);
  return decoded.replace(/\s+/g, " ").trim();
}

async function readResponseBodyWithLimit(response) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const {done, value} = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      throw createHttpError(413, "Response body too large (max 2 MB)");
    }

    chunks.push(value);
  }

  const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return merged.toString("utf8");
}

async function writeSummaryDoc(data) {
  const docRef = await db.collection("summaries").add(data);
  return docRef.id;
}

async function handleCreateSummaryFromUrl(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ok: false, error: "Method not allowed"});
    return;
  }

  const incomingUrl = req.body && typeof req.body.url === "string" ? req.body.url.trim() : "";
  let normalizedUrl = incomingUrl;

  console.log("createSummaryFromUrl start", {url: normalizedUrl});

  try {
    if (!normalizedUrl) {
      throw createHttpError(400, "Missing 'url' in request body");
    }

    if (normalizedUrl.length > MAX_URL_LENGTH) {
      throw createHttpError(400, "URL too long (max 2048 chars)");
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(normalizedUrl);
      normalizedUrl = parsedUrl.toString();
    } catch (error) {
      throw createHttpError(400, "Invalid URL");
    }

    if (!(parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")) {
      throw createHttpError(400, "Only http/https URLs are allowed");
    }

    if (isBlockedHostname(parsedUrl.hostname)) {
      throw createHttpError(400, "URL host is not allowed");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(normalizedUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw createHttpError(504, "Fetch timed out after 15 seconds");
      }
      throw createHttpError(502, `Fetch failed: ${error.message}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw createHttpError(502, `Upstream returned HTTP ${response.status}`);
    }

    const contentTypeHeader = response.headers.get("content-type") || "";
    const contentType = contentTypeHeader.split(";")[0].trim().toLowerCase();
    if (!(contentType === "text/html" || contentType === "text/plain")) {
      throw createHttpError(415, `Unsupported content type: ${contentType || "unknown"}`);
    }

    const rawText = await readResponseBodyWithLimit(response);
    const extractedText = contentType === "text/html" ? extractTextFromHtml(rawText) : rawText;
    const normalizedText = extractedText.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_CHARS);

    const docData = {
      source: {type: "url", url: normalizedUrl},
      status: "done",
      fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
      contentType,
      text: normalizedText,
    };

    const docId = await writeSummaryDoc(docData);
    console.log("createSummaryFromUrl complete", {docId, status: "done"});

    res.status(200).json({
      ok: true,
      id: docId,
      status: "done",
      chars: normalizedText.length,
    });
  } catch (error) {
    const status = error.status || 500;
    const message = error.message || "Unexpected error";

    const failedDoc = {
      source: {type: "url", url: normalizedUrl || null},
      status: "failed",
      fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
      error: message,
    };

    let docId;
    try {
      docId = await writeSummaryDoc(failedDoc);
      console.log("createSummaryFromUrl complete", {docId, status: "failed", error: message});
    } catch (writeError) {
      console.error("Failed writing failed summary doc", writeError);
    }

    res.status(status).json({ok: false, error: message, id: docId || null, status: "failed"});
  }
}

exports.createSummaryFromUrl = functions.https.onRequest(handleCreateSummaryFromUrl);
