import { keys } from "@railback/lib";
import type { NewSepaReport, SepaReport, SepaReportRepo } from "@railback/lib";
import type { SepaReportItem } from "@railback/lib";

import { getRow, type MemState, putRow } from "./state.js";

function toItem(r: SepaReport): SepaReportItem {
  const item: SepaReportItem = {
    PK: keys.sepaReportPk(r.date),
    SK: keys.sepaReportSk(r.reportId),
    report_type: r.report_type,
    s3_bucket: r.s3_bucket,
    s3_key: r.s3_key,
    sender: r.sender,
    ingest_source: r.ingest_source,
    mandates_correlated: r.mandates_correlated,
    parsed_at: r.parsed_at,
    received_at: r.received_at,
  };
  if (r.ttl !== undefined) item.ttl = r.ttl;
  return item;
}

function fromItem(it: SepaReportItem): SepaReport {
  // PK = SEPA#REPORT#<date>, SK = REPORT#<reportId>
  const date = it.PK.slice("SEPA#REPORT#".length);
  const reportId = it.SK.slice("REPORT#".length);
  const r: SepaReport = {
    date,
    reportId,
    report_type: it.report_type,
    s3_bucket: it.s3_bucket,
    s3_key: it.s3_key,
    sender: it.sender,
    ingest_source: it.ingest_source,
    mandates_correlated: it.mandates_correlated,
    parsed_at: it.parsed_at,
    received_at: it.received_at,
  };
  if (it.ttl !== undefined) r.ttl = it.ttl;
  return r;
}

export class InMemorySepaReportRepo implements SepaReportRepo {
  constructor(private readonly state: MemState) {}

  async put(input: NewSepaReport): Promise<SepaReport> {
    const r: SepaReport = {
      date: input.date,
      reportId: input.reportId,
      report_type: input.report_type,
      s3_bucket: input.s3_bucket,
      s3_key: input.s3_key,
      sender: input.sender,
      ingest_source: "MANUAL_UPLOAD",
      mandates_correlated: input.mandates_correlated,
      parsed_at: new Date().toISOString(),
      received_at: input.received_at,
    };
    const item = toItem(r);
    putRow(this.state, item.PK, item.SK, item);
    return r;
  }

  async getByReportId(date: string, reportId: string): Promise<SepaReport | null> {
    const it = getRow<SepaReportItem>(this.state, keys.sepaReportPk(date), keys.sepaReportSk(reportId));
    return it ? fromItem(it) : null;
  }
}
