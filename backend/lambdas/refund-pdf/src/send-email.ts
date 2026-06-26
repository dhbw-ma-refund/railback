// Re-export shim. The real implementation lives in @railback/lib/email/send-email
// — refund-pdf no longer owns SES outbound. This shim exists so existing
// imports of `@railback/refund-pdf/send-email` (e.g. user-handler test setup)
// keep working without churn.
export * from "@railback/lib/email/send-email";
