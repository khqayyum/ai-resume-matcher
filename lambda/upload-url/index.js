const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const client = new S3Client({});

// CORS headers used on ALL responses
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, update",
  "Access-Control-Allow-Headers": "Content-Type"
};

exports.handler = async (event) => {
  // Support both REST API (event.httpMethod) and HTTP API (event.requestContext.http.method)
  const method =
    (event?.requestContext?.http?.method || event?.httpMethod || "GET").toUpperCase();

  // Handle the browser's CORS preflight
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }

  try {
    const qs = event.queryStringParameters || {};
    const safeName = (qs.file || `resume-${Date.now()}.pdf`).replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const key = `uploads/${Date.now()}-${safeName}`;

    // No ContentType here (avoids signature mismatches)
    const cmd = new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: key
    });

    const uploadUrl = await getSignedUrl(client, cmd, { expiresIn: 300 });

    return {
      statusCode: 200,
      headers: {"Content-Type": "application/json" },
      body: JSON.stringify({ uploadUrl, objectKey: key })
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: {"Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal Server Error" })
    };
  }
};
