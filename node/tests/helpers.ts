import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { RailBackConnector } from "../src/connector.js";

export function makeDb(): RailBackConnector {
  const endpoint = process.env["DYNAMODB_ENDPOINT_URL"] ?? "http://localhost:8000";
  const client = new DynamoDBClient({
    region: "eu-north-1",
    endpoint,
    credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
  });
  return new RailBackConnector(DynamoDBDocumentClient.from(client));
}

export function makeBadDb(): RailBackConnector {
  const client = new DynamoDBClient({
    region: "eu-north-1",
    endpoint: "http://localhost:19999",
    credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
    requestHandler: new NodeHttpHandler({ connectionTimeout: 500, requestTimeout: 500 }),
    maxAttempts: 1,
  });
  return new RailBackConnector(DynamoDBDocumentClient.from(client));
}
