// Shared S3-client config for the S3 access sites in this package
// (presigned-post.ts, presigned-get.ts, blob-repo.ts).
//
// Credential resolution — two modes, selected by env:
//
//   1. Default chain (production Lambda + tests + local mocks):
//      no Cognito env set → we return only { region }. The S3Client falls
//      back to the standard AWS credential provider chain (Lambda execution
//      role, AWS_* env vars, shared config). This is the unchanged behaviour
//      the sites had before, so every existing test still passes.
//
//   2. Cognito Identity Pool (the professor's demo identity):
//      RAILBACK_COGNITO_IDENTITY_POOL_ID set → we resolve credentials via
//      fromCognitoIdentityPool against that pool. This is the SAME pool the
//      frontend stub (s3-bucket-upload-railback/lib/elaspix_fileupload.js)
//      uses client-side; here we use it server-side to SIGN presigned POST
//      upload policies so the browser upload succeeds.
//
// IMPORTANT — probed against the real account 2026-07-11:
//   * the deployed dispatcher's IAM principal (`s241539`) is DENIED
//     s3:PutObject on raw/ and belege/, so a presigned POST it signs would
//     be rejected by S3. The Cognito unauth role (`railback_unauthrole`) IS
//     allowed s3:PutObject on those prefixes → signing the upload presign
//     with the Cognito identity is what makes the upload endpoint work.
//   * that same Cognito role is DENIED s3:GetObject. So the Cognito path is
//     "signing" scope ONLY. blob-repo.ts (direct GetObject/PutObject byte
//     I/O) must stay on the default chain — pointing it at Cognito would
//     break every read. Hence the `purpose` gate below.
//
//   DEMO-ONLY. Per the account owner's instruction this points RailBack's
//   upload-presign at the unauthenticated demo pool. It is NOT how a
//   production deployment should authenticate — a scoped Lambda execution
//   role is. Mode 1 stays the default so nothing but an explicit env opt-in
//   takes this path.
//
// This module IS allowed to import @aws-sdk/* directly — the
// no-restricted-imports rule in .eslintrc.cjs excludes lib/src/storage/s3/**.

import type { S3ClientConfig } from "@aws-sdk/client-s3";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";

import { AppError } from "../../errors/index.js";

/**
 * Region for all S3 clients in this package. Mirrors the pre-existing
 * behaviour: RAILBACK_AWS_REGION is required, no default.
 */
export function getRegion(): string {
  const region = process.env.RAILBACK_AWS_REGION;
  if (!region) {
    throw new AppError(
      "ERR_INTERNAL",
      "RAILBACK_AWS_REGION not set; cannot construct S3 client"
    );
  }
  return region;
}

/**
 * Which access site is asking. "presign" sites only ever SIGN policies (they
 * never call S3 with these creds at request time), so they can use the
 * Cognito demo identity — whose role has PutObject but not GetObject.
 * "direct" sites (blob-repo GetObject/PutObject) must stay on the default
 * chain because the Cognito role cannot GetObject. See the probe notes above.
 */
export type S3Purpose = "presign" | "direct";

/**
 * Build the S3ClientConfig an access site should use. Returns just { region }
 * (default credential chain) unless the site is a "presign" site AND
 * RAILBACK_COGNITO_IDENTITY_POOL_ID is set — then it signs with the Cognito
 * demo identity.
 */
export function s3ClientConfig(purpose: S3Purpose = "direct"): S3ClientConfig {
  const region = getRegion();
  const identityPoolId = process.env.RAILBACK_COGNITO_IDENTITY_POOL_ID;
  if (purpose !== "presign" || !identityPoolId) {
    return { region };
  }
  return {
    region,
    credentials: fromCognitoIdentityPool({
      identityPoolId,
      clientConfig: {
        // RAILBACK_COGNITO_REGION lets the demo override the pool region
        // independently of the bucket region; defaults to the S3 region.
        region: process.env.RAILBACK_COGNITO_REGION ?? region,
        // Force the internal CognitoIdentity client to call GetId /
        // GetCredentialsForIdentity ANONYMOUSLY — exactly like the browser
        // demo does. Without this, inside Lambda the client inherits the
        // execution role's container credentials and the SDK ends up
        // signing the presign with the EXECUTION ROLE instead of the
        // Cognito unauth role (observed 2026-07-11: deployed presign was
        // signed by lambdaFunctionRole_students → S3 403, since that role
        // has no s3:PutObject). Anonymous creds pin the unauthenticated
        // identity flow so the returned credentials are always the
        // railback_unauthrole ones we probed as PutObject-capable.
        credentials: async () => ({ accessKeyId: "", secretAccessKey: "" }),
      },
    }),
  };
}
