// Minimal subset of the API Gateway HTTP API v2 event/response we use. Mirrors
// lambdas/auth-handler/src/event.ts verbatim — both lambdas could share a
// helper module under @railback/lib/http later, but copying keeps each
// lambda's zip self-contained for the Phase-5 bundle step.

export interface ApiGwEvent {
  version: "2.0";
  routeKey?: string;
  rawPath?: string;
  rawQueryString?: string;
  headers: Record<string, string | undefined>;
  requestContext: {
    http: {
      method: string;
      path: string;
      protocol?: string;
      sourceIp?: string;
      userAgent?: string;
    };
    requestId?: string;
  };
  body?: string;
  isBase64Encoded?: boolean;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
}

export interface ApiGwResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Pull the parsed JSON body out of an API GW event. Empty body → null. */
export function readJsonBody(event: ApiGwEvent): unknown {
  if (event.body === undefined || event.body === null || event.body === "") {
    return null;
  }
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
