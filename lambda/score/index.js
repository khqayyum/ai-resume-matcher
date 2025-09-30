// IAM: s3:GetObject on arn:aws:s3:::<bucket>/extracted/* and arn:aws:s3:::<bucket>/maps/*

const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const s3 = new S3Client({});
const BUCKET = process.env.BUCKET_NAME;

// ---------- helpers ----------
const streamToString = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });

const CORS = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS,GET",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin"
});

// super-light tokenizer + Jaccard-ish score
const norm = (t) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const bag = (t) => {
  const m = new Map();
  for (const w of norm(t).split(" ")) if (w) m.set(w, (m.get(w) || 0) + 1);
  return m;
};
const scoreOverlap = (resumeText, jobText) => {
  const r = bag(resumeText), j = bag(jobText);
  const stop = new Set(["the","and","a","an","to","of","in","on","for","with","is","are","as","by","this","that","be","or","at"]);
  let inter = 0, union = 0;
  const keys = new Set([...r.keys(), ...j.keys()]);
  for (const k of keys) {
    if (stop.has(k) || k.length < 3) continue;
    const rv = r.get(k) || 0, jv = j.get(k) || 0;
    inter += Math.min(rv, jv);
    union += Math.max(rv, jv);
  }
  const percent = union ? Math.round((inter / union) * 100) : 0;
  const missing = [];
  for (const [k, jv] of j.entries()) {
    if (stop.has(k) || k.length < 3) continue;
    if (!r.has(k)) missing.push([k, jv]);
  }
  missing.sort((a, b) => b[1] - a[1]);
  return { score: percent, missing: missing.slice(0, 20).map(x => x[0]) };
};

// ---------- handler ----------
exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin;

  // CORS preflight
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 204, headers: CORS(origin) };
  }

  try {
    const method = event.requestContext?.http?.method || "GET";
    const qs = event.queryStringParameters || {};

    // Accept either ?key=extracted/<JobId>.json OR body.objectKey
    let extractedKey = qs.key;
    let objectKey = "";
    let jobText = "";

    // ---------- GET: polling by objectKey ----------
    if (method === "GET" && !extractedKey && qs.objectKey) {
      const mapKey = `maps/by-upload/${encodeURIComponent(qs.objectKey)}.json`;
      const mapObj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: mapKey }));
      const mapData = JSON.parse(await streamToString(mapObj.Body));

      if (!mapData || mapData.status !== "COMPLETED" || !mapData.extractedKey) {
        return { statusCode: 202, headers: CORS(origin), body: JSON.stringify({ status: mapData?.status || "PENDING" }) };
      }
      // READY: tell the client it's done and what the extracted key is
      return {
        statusCode: 200,
        headers: { ...CORS(origin), "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED", extractedKey: mapData.extractedKey })
      };
    }

    // ---------- POST: scoring path ----------
    if (!extractedKey) {
      // read body
      let body = {};
      if (event.body) {
        body = event.isBase64Encoded
          ? JSON.parse(Buffer.from(event.body, "base64").toString("utf8") || "{}")
          : JSON.parse(event.body || "{}");
      }
      objectKey = body.objectKey || "";
      jobText = body.jobText || "";

      if (!extractedKey && objectKey) {
        // look up map to find extracted key
        const mapKey = `maps/by-upload/${encodeURIComponent(objectKey)}.json`;
        const mapObj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: mapKey }));
        const mapData = JSON.parse(await streamToString(mapObj.Body));

        if (!mapData || mapData.status !== "COMPLETED" || !mapData.extractedKey) {
          return { statusCode: 202, headers: CORS(origin), body: JSON.stringify({ status: mapData?.status || "PENDING" }) };
        }
        extractedKey = mapData.extractedKey;
      }
    }

    if (!extractedKey) {
      return {
        statusCode: 400,
        headers: { ...CORS(origin), "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Provide ?key=extracted/<JobId>.json or POST {objectKey, jobText}" })
      };
    }

    // We are in POST (scoring). Require jobText now.
    if (method === "POST") {
      // Ensure jobText (if not already parsed above)
      if (!jobText && event.body) {
        const body = event.isBase64Encoded
          ? JSON.parse(Buffer.from(event.body, "base64").toString("utf8") || "{}")
          : JSON.parse(event.body || "{}");
        jobText = body.jobText || "";
      }
      if (!jobText) {
        return {
          statusCode: 400,
          headers: { ...CORS(origin), "Content-Type": "application/json" },
          body: JSON.stringify({ error: "jobText body is required" })
        };
      }

      // Fetch extracted JSON and score
      const extractedObj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: extractedKey }));
      const extractedJson = JSON.parse(await streamToString(extractedObj.Body));
      const resumeText = Array.isArray(extractedJson.Lines) ? extractedJson.Lines.join("\n") : "";
      const result = scoreOverlap(resumeText, jobText);

      return {
        statusCode: 200,
        headers: { ...CORS(origin), "Content-Type": "application/json" },
        body: JSON.stringify({ key: extractedKey, ...result })
      };
    }

    // Any other method
    return { statusCode: 405, headers: CORS(origin), body: "Method Not Allowed" };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { ...CORS(event?.headers?.origin || event?.headers?.Origin), "Content-Type": "text/plain" },
      body: "error"
    };
  }
};
