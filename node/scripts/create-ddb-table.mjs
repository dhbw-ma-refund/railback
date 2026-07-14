#!/usr/bin/env node
// Idempotent DynamoDB table bootstrapper for RailBack.
//
// - Reads endpoint from DYNAMODB_ENDPOINT_URL (default http://localhost:8000)
// - Reads region from RAILBACK_DDB_REGION (default eu-north-1)
// - Reads table name from RAILBACK_DDB_TABLE (default RailBack)
//
// Creates a single table with pk/sk hash+range and four GSIs, matching
// DB_SCHEMA.md. All attribute names are lowercase snake_case.
//
// Idempotent: swallows ResourceInUseException so re-runs are cheap.

import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} from "@aws-sdk/client-dynamodb";

const ENDPOINT = process.env.DYNAMODB_ENDPOINT_URL || "http://localhost:8000";
const REGION = process.env.RAILBACK_DDB_REGION || "eu-north-1";
const TABLE = process.env.RAILBACK_DDB_TABLE || "RailBack";

function makeClient() {
  return new DynamoDBClient({
    endpoint: ENDPOINT,
    region: REGION,
    // DDB Local ignores these but the SDK needs *something*.
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "local",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "local",
    },
  });
}

const TABLE_SPEC = (name) => ({
  TableName: name,
  BillingMode: "PAY_PER_REQUEST",
  AttributeDefinitions: [
    { AttributeName: "pk", AttributeType: "S" },
    { AttributeName: "sk", AttributeType: "S" },
    { AttributeName: "gsi1_pk", AttributeType: "S" },
    { AttributeName: "gsi1_sk", AttributeType: "S" },
    { AttributeName: "gsi2_pk", AttributeType: "S" },
    { AttributeName: "gsi2_sk", AttributeType: "S" },
    { AttributeName: "gsi_email_pending_pk", AttributeType: "S" },
    { AttributeName: "gsi_email_pending_sk", AttributeType: "S" },
    { AttributeName: "gsi3_pk", AttributeType: "S" },
    { AttributeName: "gsi3_sk", AttributeType: "S" },
  ],
  KeySchema: [
    { AttributeName: "pk", KeyType: "HASH" },
    { AttributeName: "sk", KeyType: "RANGE" },
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: "gsi1",
      KeySchema: [
        { AttributeName: "gsi1_pk", KeyType: "HASH" },
        { AttributeName: "gsi1_sk", KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "ALL" },
    },
    {
      IndexName: "gsi2",
      KeySchema: [
        { AttributeName: "gsi2_pk", KeyType: "HASH" },
        { AttributeName: "gsi2_sk", KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "KEYS_ONLY" },
    },
    {
      IndexName: "gsi_email_pending",
      KeySchema: [
        { AttributeName: "gsi_email_pending_pk", KeyType: "HASH" },
        { AttributeName: "gsi_email_pending_sk", KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "KEYS_ONLY" },
    },
    {
      IndexName: "gsi3",
      KeySchema: [
        { AttributeName: "gsi3_pk", KeyType: "HASH" },
        { AttributeName: "gsi3_sk", KeyType: "RANGE" },
      ],
      Projection: { ProjectionType: "ALL" },
    },
  ],
});

export async function createTable({ tableName = TABLE, client } = {}) {
  const ddb = client || makeClient();
  try {
    await ddb.send(new CreateTableCommand(TABLE_SPEC(tableName)));
    return { status: "created", tableName };
  } catch (err) {
    if (err && (err.name === "ResourceInUseException" || err.$metadata?.httpStatusCode === 400 && /already exists/i.test(String(err.message)))) {
      return { status: "exists", tableName };
    }
    throw err;
  }
}

// CLI entry point when invoked directly.
const isDirect = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("create-ddb-table.mjs");

if (isDirect) {
  createTable()
    .then((r) => {
      if (r.status === "created") {
        console.log(`created table ${r.tableName} at ${ENDPOINT} (${REGION})`);
      } else {
        console.log(`table ${r.tableName} already exists at ${ENDPOINT} (${REGION})`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("create-ddb-table failed:", err);
      process.exit(1);
    });
}
