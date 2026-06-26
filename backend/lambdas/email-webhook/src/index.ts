// Public entry-point. AWS Lambda runtime invokes `handler` directly with the
// SNS event payload.

export { handler } from "./handler.js";
export type { SnsEvent, SnsRecord, SesEvent } from "./parse-sns.js";
