# AI Resume Matcher (Serverless on AWS)

End-to-end serverless pipeline to match resume PDFs against job descriptions.

---

## 🚀 Demo
- **UI (CloudFront):** https://d2a16brw1up50y.cloudfront.net

---

## 📐 Architecture
![Architecture](docs/architecture.png)

Or see below (Mermaid):

```mermaid
flowchart LR
  UI[index_final.html<br/>(CloudFront)] --> API[API Gateway<br/>GET /upload-url]
  API --> UP[Lambda: upload-url]
  UP --> S3[(S3: uploads/)]
  S3 --> EVB[EventBridge] --> DIS[Lambda: dispatcher]
  DIS --> TEX[Textract]
  TEX --> SNS[(SNS)] --> COL[Lambda: collector]
  COL --> EXT[(S3: extracted/)]
  COL --> MAPS[(S3: maps/)]
  UI --> SCORE[Lambda URL: score]
  SCORE --> EXT
  SCORE --> MAPS
