const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { TextractClient, GetDocumentTextDetectionCommand } = require("@aws-sdk/client-textract");
const s3 = new S3Client({});
const tex = new TextractClient({});

const streamToString = async (stream) =>
  await new Promise((resolve, reject) => {
    const chunks=[]; stream.on('data', c=>chunks.push(c));
    stream.on('error', reject);
    stream.on('end', ()=> resolve(Buffer.concat(chunks).toString('utf-8')));
  });

async function putJson(bucket, key, obj) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: "application/json",
    Body: JSON.stringify(obj)
  }));
}

exports.handler = async (event) => {
  console.log("SNS EVENT:", JSON.stringify(event));
  const rec = event.Records?.[0];
  if (!rec?.Sns?.Message) { console.log("No SNS message."); return { statusCode: 200 }; }

  let msg; try { msg = JSON.parse(rec.Sns.Message); } catch { msg = {}; }
  const status = msg?.Status || msg?.JobStatus || "UNKNOWN";
  const jobId  = msg?.JobId || "";
  const docLoc = msg?.DocumentLocation?.S3Object || {}; // may have {Bucket, Name}
  console.log("JobId:", jobId, "Status:", status, "DocLoc:", JSON.stringify(docLoc));

  if (status !== "SUCCEEDED" || !jobId) { console.log("Not SUCCEEDED; exiting."); return { statusCode: 200 }; }

  const bucket = process.env.BUCKET_NAME;
  const byJobKey = `maps/by-job/${jobId}.json`;

  // Recover original objectKey from our map; fallback to SNS DocumentLocation
  let objectKey = "";
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: byJobKey }));
    const map = JSON.parse(await streamToString(obj.Body));
    objectKey = map.objectKey || "";
  } catch (e) {
    console.warn("by-job map not found; using SNS DocumentLocation if present.", e?.message);
    if (docLoc?.Name) objectKey = docLoc.Name;
  }

  // Pull all pages
  const lines = [];
  let nextToken;
  do {
    const out = await tex.send(new GetDocumentTextDetectionCommand({
      JobId: jobId,
      MaxResults: 1000,
      NextToken: nextToken
    }));
    nextToken = out.NextToken;
    for (const b of out.Blocks || []) {
      if (b.BlockType === "LINE" && b.Text) lines.push(b.Text);
    }
  } while (nextToken);

  // Save extracted text
  const extractedKey = `extracted/${jobId}.json`;
  await putJson(bucket, extractedKey, {
    JobId: jobId,
    SourceObjectKey: objectKey,
    Lines: lines
  });
  console.log("Saved extracted:", extractedKey, "lines:", lines.length);

  const ts = new Date().toISOString();

  // Update maps/by-job/<JobId>.json
  await putJson(bucket, byJobKey, {
    jobId,
    status: "COMPLETED",
    objectKey,
    extractedKey,
    ts
  });
  console.log("Updated", byJobKey);

  // Update maps/by-upload/<objectKey>.json
  if (objectKey) {
    const byUploadKey = `maps/by-upload/${encodeURIComponent(objectKey)}.json`;
    // keep existing jobId if present
    let jobFromUpload = jobId;
    try {
      const g = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: byUploadKey }));
      const old = JSON.parse(await streamToString(g.Body));
      jobFromUpload = old.jobId || jobFromUpload;
    } catch {}
    await putJson(bucket, byUploadKey, {
      jobId: jobFromUpload,
      status: "COMPLETED",
      objectKey,
      extractedKey,
      ts
    });
    console.log("Updated", byUploadKey);
  }

  return { statusCode: 200 };
};
