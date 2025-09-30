# AI Resume Matcher (Serverless on AWS)

End-to-end serverless pipeline to match resume PDFs against job descriptions.

---

## 🚀 Demo
- **UI (CloudFront):** https://d2a16brw1up50y.cloudfront.net

---

## Architecture

```mermaid
flowchart LR
  UI[index_final.html (CloudFront)] --> API[API Gateway GET /upload-url]
  API --> UP[Lambda: upload-url]
  UP --> S3[(S3 uploads/)]
  S3 --> EVB[EventBridge] --> DIS[Lambda: dispatcher]
  DIS --> TEX[Textract]
  TEX --> SNS[(SNS Topic)] --> COL[Lambda: collector]
  COL --> EXT[(S3 extracted/)]
  COL --> MAPS[(S3 maps/)]
  UI --> SCORE[Lambda URL: score]
  SCORE --> EXT
  SCORE --> MAPS

