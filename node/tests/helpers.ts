import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { RailBackConnector } from "../src/connector.js";
import { DdbBackend } from "../src/adapter.js";

function makeClient(endpoint: string, timeout?: number): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: "eu-north-1",
    endpoint,
    credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
    ...(timeout !== undefined ? {
      requestHandler: new NodeHttpHandler({ connectionTimeout: timeout, requestTimeout: timeout }),
      maxAttempts: 1,
    } : {}),
  });
  return DynamoDBDocumentClient.from(client);
}

export function makeDb(): RailBackConnector {
  return new RailBackConnector(makeClient(process.env["DYNAMODB_ENDPOINT_URL"] ?? "http://localhost:8000"));
}

export function makeBadDb(): RailBackConnector {
  return new RailBackConnector(makeClient("http://localhost:19999", 500));
}

export function makeBackend(): DdbBackend {
  return new DdbBackend(makeClient(process.env["DYNAMODB_ENDPOINT_URL"] ?? "http://localhost:8000"));
}

export function makeBadBackend(): DdbBackend {
  return new DdbBackend(makeClient("http://localhost:19999", 500));
}

