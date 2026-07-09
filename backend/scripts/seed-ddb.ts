// One-shot seed for a DDB deployment (Phase 4): creates one test admin and
// one test user with encrypted IBAN/BIC, so auth + read-only endpoints have
// something to serve. Idempotent-ish: the user create is conditional
// (attribute_not_exists), so a second run throws ERR_CONFLICT on the user —
// that's fine, it means the seed already ran.
//
// Works against DDB Local or real AWS. Configure via env:
//   RAILBACK_DDB_TABLE        (default "RailBack")
//   RAILBACK_DDB_REGION       (default "eu-north-1")
//   DYNAMODB_ENDPOINT_URL     (set to http://localhost:8000 for DDB Local;
//                              leave unset to hit real AWS)
//   RAILBACK_IBAN_KEK         (base64 32-byte KEK — REQUIRED; must match the
//                              KEK the Lambdas run with, or decrypt fails)
//   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
//   SEED_USER_EMAIL  / SEED_USER_PASSWORD
//
// Run:
//   RAILBACK_IBAN_KEK=$(head -c32 /dev/urandom | base64) \
//   DYNAMODB_ENDPOINT_URL=http://localhost:8000 \
//   npx tsx scripts/seed-ddb.ts

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

import { hashPassword } from "@railback/lib/auth/password";
import { encryptBic, encryptIban } from "@railback/lib/crypto/iban";
import { normaliseEmail } from "@railback/lib/storage/ddb/keys";
import { DdbBackend } from "@railback/db/adapter";

const TABLE = process.env.RAILBACK_DDB_TABLE ?? "RailBack";
const REGION = process.env.RAILBACK_DDB_REGION ?? "eu-north-1";
const ENDPOINT = process.env.DYNAMODB_ENDPOINT_URL; // undefined → real AWS

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@railback.example";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "admin-seed-pw-1";
const USER_EMAIL = process.env.SEED_USER_EMAIL ?? "seed-user@railback.example";
const USER_PASSWORD = process.env.SEED_USER_PASSWORD ?? "user-seed-pw-1";

const USER_IBAN = "DE89370400440532013000";
const USER_BIC = "COBADEFFXXX";

function makeClient(): DynamoDBDocumentClient {
  const base = new DynamoDBClient({
    region: REGION,
    ...(ENDPOINT
      ? { endpoint: ENDPOINT, credentials: { accessKeyId: "local", secretAccessKey: "local" } }
      : {}),
  });
  return DynamoDBDocumentClient.from(base);
}

async function main(): Promise<void> {
  if (!process.env.RAILBACK_IBAN_KEK) {
    throw new Error("RAILBACK_IBAN_KEK is required (base64 32-byte key)");
  }
  const client = makeClient();
  const backend = new DdbBackend(client as never);

  // --- admin row (no adapter create method — admins are out-of-band) --------
  const adminEmail = normaliseEmail(ADMIN_EMAIL);
  const adminHashed = await hashPassword(ADMIN_PASSWORD);
  await client.send(new PutCommand({
    TableName: TABLE,
    Item: {
      pk: `ADMIN#${adminEmail}`,
      sk: "PROFILE",
      gsi1_pk: "ADMIN",
      gsi1_sk: `EMAIL#${adminEmail}`,
      email: adminEmail,
      hashed_password: adminHashed,
      created_at: new Date().toISOString(),
    },
  }));
  // eslint-disable-next-line no-console
  console.log(`seeded admin ${adminEmail}`);

  // --- user row (via adapter, conditional create) ---------------------------
  const userHashed = await hashPassword(USER_PASSWORD);
  try {
    await backend.users.create({
      email: USER_EMAIL,
      vorname: "Seed",
      nachname: "User",
      telefon: "+49 151 0000000",
      adresse: { strasse: "Teststr.", hausnr: "1", plz: "10115", ort: "Berlin", land: "DE" },
      hashed_password: userHashed,
      iban_enc: encryptIban(USER_IBAN),
      bic_enc: encryptBic(USER_BIC),
      datenschutz_einwilligung: true,
      agb_akzeptiert: true,
    });
    // eslint-disable-next-line no-console
    console.log(`seeded user ${normaliseEmail(USER_EMAIL)} (iban ${USER_IBAN})`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ERR_CONFLICT") {
      // eslint-disable-next-line no-console
      console.log(`user ${normaliseEmail(USER_EMAIL)} already exists — skipping`);
    } else {
      throw err;
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    // eslint-disable-next-line no-console
    console.error("seed-ddb failed:", err);
    process.exit(1);
  },
);
