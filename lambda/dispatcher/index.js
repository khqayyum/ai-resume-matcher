const { TextractClient, StartDocumentTextDetectionCommand } = require("@aws-sdk/client-textract");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const textract = new TextractClient({});
const s3 = new S3Client({});

exports.handler = async (event) => {
  try {
    // Accept either S3 Notification or EventBridge
    let bucket = "", key = "";

    if (event?.Records?.[0]?.s3) {
      const rec = event.Records[0];
      bucket = rec.s3.bucket.name || "";
      key    = rec.s3.object.key || "";
      key = decodeURIComponent(String(key).replace(/\+/g, " "));
    } else if (event?.detail) {
      const d = event.detail;
      bucket = d?.bucket?.name || process.env.BUCKET_NAME || "";
      key    = d?.object?.key ? decodeURIComponent(String(d.object.key).replace(/\+/g, " ")) : "";
    }

    console.log("BUCKET:", bucket, "KEY:", key);

    if (!bucket || !key) {
      console.warn("Missing bucket/key, skipping.");
      return { statusCode: 400, body: "missing bucket/key" };
    }

    // Only process PDFs under uploads/
    if (!key.startsWith("uploads/") || !key.toLowerCase().endsWith(".pdf")) {
      console.log("Ignoring:", key);
      return { statusCode: 200, body: "ignored" };
    }

    const params = {
      DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
      NotificationChannel: {
        SNSTopicArn: process.env.SNS_TOPIC_ARN,
        RoleArn: process.env.TEXTRACT_ROLE_ARN
      }
    };
    console.log("PARAMS", JSON.stringify(params));

    const out = await textract.send(new StartDocumentTextDetectionCommand(params));
    console.log("Started Textract job:", out.JobId);

    // Write mapping files immediately so UI can resolve either direction
    const now = new Date().toISOString();

    // by-upload mapping
    const byUploadKey = `maps/by-upload/${encodeURIComponent(key)}.json`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: byUploadKey,
      ContentType: "application/json",
      Body: JSON.stringify({
        jobId: out.JobId,
        status: "STARTED",
        objectKey: key,
        ts: now
      })
    }));
    console.log("Wrote", byUploadKey);

    // by-job mapping
    const byJobKey = `maps/by-job/${out.JobId}.json`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: byJobKey,
      ContentType: "application/json",
      Body: JSON.stringify({
        jobId: out.JobId,
        status: "STARTED",
        objectKey: key,
        ts: now
      })
    }));
    console.log("Wrote", byJobKey);

    return { statusCode: 200, body: `started ${out.JobId}` };
  } catch (err) {
    console.error("Dispatcher error:", err);
    return { statusCode: 500, body: "textract-start-failed" };
  }
};
