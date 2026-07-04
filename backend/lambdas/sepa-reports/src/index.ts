// Public entry-point. AWS Lambda calls `handler(event)`; tests import
// `processReport` directly to run one record synchronously against seeded
// mocks.

export {
  handler,
  processReport,
  type S3Event,
  type S3EventRecord,
  type HandlerResult,
  type ProcessReportArgs,
  type ProcessReportResult,
} from "./handler.js";

export {
  detectReportKind,
  type ReportKind,
} from "./detect-kind.js";

export {
  decideBatch,
  decideCamt053Batch,
  decideCamt054,
  decideCamt054Batch,
  decidePain002,
  decidePain002Batch,
  type MandateAction,
  type MandateDecision,
  type MandateInput,
} from "./apply-transitions.js";

export {
  sendRtxNotifyEmail,
  type SendRtxNotifyInput,
  type SendRtxNotifyResult,
} from "./notify.js";
