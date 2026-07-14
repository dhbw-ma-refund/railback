// Generates schema/openapi.yaml from the zod schemas in @railback/lib.
//
// - Registers every response/request schema decorated with .openapi() as a
//   named component.
// - Registers every HTTP route Lambdas dispatch (see lambdas/*/src/handler.ts
//   and API_CONTRACT_USERFORMS.md / API_CONTRACT_ADMINFORMS.md).
// - Serialises the OpenAPI-3.0.3 document to YAML and writes it to
//   schema/openapi.yaml, the committed contract source of truth.
//
// Regenerate: `npm run generate:openapi`. CI drift check:
// `npm run check:openapi-drift`.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import yaml from "js-yaml";

// Importing from lib/schemas triggers extendZodWithOpenApi via common.ts.
import {
  authResponseSchema,
  registerRequestSchema,
  loginRequestSchema,
  refreshRequestSchema,
  errorBodySchema,
  getUserResponseSchema,
  patchUserRequestSchema,
  refundDataResponseSchema,
  patchBankRequestSchema,
  deleteUserRequestSchema,
  uploadRequestSchema,
  uploadResponseSchema,
  uploadConfirmRequestSchema,
  uploadConfirmResponseSchema,
  ticketResponseSchema,
  listTicketsResponseSchema,
  refundRequestSchema,
  refundResponseSchema,
  routeLookupRequestSchema,
  routeLookupResponseSchema,
  fromRouteRequestSchema,
  fromRouteResponseSchema,
  delaysRequestSchema,
  delaysResponseSchema,
  belegPresignRequestSchema,
  belegPresignResponseSchema,
  belegConfirmRequestSchema,
  belegConfirmResponseSchema,
  routeTemplateSchema,
  listRouteTemplatesResponseSchema,
  createRouteTemplateRequestSchema,
  patchRouteTemplateRequestSchema,
  adminStatsResponseSchema,
  listUsersResponseSchema,
  getAdminUserResponseSchema,
  patchAdminUserRequestSchema,
  listAdminTicketsResponseSchema,
  getAdminTicketResponseSchema,
  patchAdminTicketRequestSchema,
  getPendingBatchesResponseSchema,
  markSubmittedRequestSchema,
  markSubmittedResponseSchema,
  pain008RebuildRequestSchema,
  sepaReportUploadRequestSchema,
  sepaReportUploadResponseSchema,
} from "../lib/src/schemas/index.js";

const registry = new OpenAPIRegistry();

// --- Bearer auth --------------------------------------------------------
const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

// --- Path params (reused) -----------------------------------------------
const ticketIdParam = registry.registerParameter(
  "TicketIdParam",
  z.string().openapi({ param: { name: "ticketId", in: "path" }, example: "01H..." }),
);
const belegIdParam = registry.registerParameter(
  "BelegIdParam",
  z.string().openapi({ param: { name: "belegId", in: "path" } }),
);
const templateIdParam = registry.registerParameter(
  "TemplateIdParam",
  z.string().openapi({ param: { name: "templateId", in: "path" } }),
);
const emailPathParam = registry.registerParameter(
  "EmailParam",
  z.string().openapi({ param: { name: "email", in: "path" } }),
);
const trainNrParam = registry.registerParameter(
  "TrainNrParam",
  z.string().openapi({ param: { name: "trainNr", in: "path" } }),
);
const dateParam = registry.registerParameter(
  "DateParam",
  z.string().openapi({ param: { name: "date", in: "path" } }),
);
const batchIdParam = registry.registerParameter(
  "BatchIdParam",
  z.string().openapi({ param: { name: "batchId", in: "path" } }),
);

// --- Common response wrappers ------------------------------------------
const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: errorBodySchema } },
});

const json = <S extends z.ZodTypeAny>(description: string, schema: S) => ({
  description,
  content: { "application/json": { schema } },
});

const commonErrors = {
  400: errorResponse("Validation error"),
  401: errorResponse("Authentication required"),
  403: errorResponse("Forbidden"),
  404: errorResponse("Not found"),
  409: errorResponse("Conflict"),
};

// --- Auth ---------------------------------------------------------------
registry.registerPath({
  method: "post",
  path: "/auth/register",
  tags: ["auth"],
  summary: "Register a new user (lands in ACTIVE).",
  request: {
    body: {
      content: { "application/json": { schema: registerRequestSchema } },
    },
  },
  responses: {
    201: json("Created", authResponseSchema),
    400: errorResponse("Validation error"),
    409: errorResponse("Email already in use"),
  },
});
registry.registerPath({
  method: "post",
  path: "/auth/login",
  tags: ["auth"],
  summary: "Log in. Same endpoint for users and admins; role in JWT claim.",
  request: {
    body: { content: { "application/json": { schema: loginRequestSchema } } },
  },
  responses: {
    200: json("OK", authResponseSchema),
    400: errorResponse("Validation error"),
    401: errorResponse("Invalid credentials"),
    403: errorResponse("Suspended or deletion-scheduled"),
  },
});
registry.registerPath({
  method: "post",
  path: "/auth/refresh",
  tags: ["auth"],
  summary: "Rotate refresh token; issue new access token.",
  request: {
    body: { content: { "application/json": { schema: refreshRequestSchema } } },
  },
  responses: {
    200: json("OK", authResponseSchema),
    401: errorResponse("Invalid refresh token"),
    403: errorResponse("Suspended or deletion-scheduled"),
  },
});

// --- User profile -------------------------------------------------------
registry.registerPath({
  method: "get",
  path: "/users/me",
  tags: ["users"],
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: json("OK", getUserResponseSchema),
    401: commonErrors[401],
  },
});
registry.registerPath({
  method: "patch",
  path: "/users/me",
  tags: ["users"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: { content: { "application/json": { schema: patchUserRequestSchema } } },
  },
  responses: {
    200: json("OK", getUserResponseSchema),
    400: commonErrors[400],
    401: commonErrors[401],
  },
});
registry.registerPath({
  method: "get",
  path: "/users/me/refund-data",
  tags: ["users"],
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: json("OK", refundDataResponseSchema),
    401: commonErrors[401],
  },
});
registry.registerPath({
  method: "patch",
  path: "/users/me/bank",
  tags: ["users"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: { content: { "application/json": { schema: patchBankRequestSchema } } },
  },
  responses: {
    200: json("OK", refundDataResponseSchema),
    400: commonErrors[400],
    401: commonErrors[401],
  },
});
registry.registerPath({
  method: "delete",
  path: "/users/me",
  tags: ["users"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: { "application/json": { schema: deleteUserRequestSchema } },
    },
  },
  responses: {
    204: { description: "Scheduled for deletion" },
    401: commonErrors[401],
    403: commonErrors[403],
  },
});

// --- User tickets -------------------------------------------------------
registry.registerPath({
  method: "get",
  path: "/users/me/tickets",
  tags: ["tickets"],
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: json("OK", listTicketsResponseSchema),
    401: commonErrors[401],
  },
});
registry.registerPath({
  method: "get",
  path: "/users/me/tickets/{ticketId}",
  tags: ["tickets"],
  security: [{ [bearerAuth.name]: [] }],
  request: { params: z.object({ ticketId: ticketIdParam }) },
  responses: {
    200: json("OK", ticketResponseSchema),
    401: commonErrors[401],
    404: commonErrors[404],
  },
});
registry.registerPath({
  method: "delete",
  path: "/users/me/tickets/{ticketId}",
  tags: ["tickets"],
  security: [{ [bearerAuth.name]: [] }],
  request: { params: z.object({ ticketId: ticketIdParam }) },
  responses: {
    204: { description: "Deleted" },
    401: commonErrors[401],
    404: commonErrors[404],
  },
});

// Upload / confirm
registry.registerPath({
  method: "post",
  path: "/users/me/tickets/{ticketId}/upload",
  tags: ["tickets"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ ticketId: ticketIdParam }),
    body: { content: { "application/json": { schema: uploadRequestSchema } } },
  },
  responses: {
    200: json("Presigned POST envelope", uploadResponseSchema),
    400: commonErrors[400],
    401: commonErrors[401],
  },
});
registry.registerPath({
  method: "post",
  path: "/users/me/tickets/{ticketId}/upload-confirm",
  tags: ["tickets"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ ticketId: ticketIdParam }),
    body: {
      content: { "application/json": { schema: uploadConfirmRequestSchema } },
    },
  },
  responses: {
    200: json("OK", uploadConfirmResponseSchema),
    400: commonErrors[400],
    401: commonErrors[401],
    409: commonErrors[409],
  },
});

// Route lookup / from-route
registry.registerPath({
  method: "post",
  path: "/users/me/tickets/route-lookup",
  tags: ["tickets"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: { "application/json": { schema: routeLookupRequestSchema } },
    },
  },
  responses: {
    200: json("Candidate connections", routeLookupResponseSchema),
    400: commonErrors[400],
    401: commonErrors[401],
  },
});
registry.registerPath({
  method: "post",
  path: "/users/me/tickets/from-route",
  tags: ["tickets"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: { "application/json": { schema: fromRouteRequestSchema } },
    },
  },
  responses: {
    201: json("MANUAL_ROUTE ticket created", fromRouteResponseSchema),
    400: commonErrors[400],
    401: commonErrors[401],
  },
});

// Delays / refund
registry.registerPath({
  method: "post",
  path: "/users/me/tickets/{ticketId}/delays",
  tags: ["tickets"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ ticketId: ticketIdParam }),
    body: { content: { "application/json": { schema: delaysRequestSchema } } },
  },
  responses: {
    200: json("OK", delaysResponseSchema),
    400: commonErrors[400],
    401: commonErrors[401],
    404: commonErrors[404],
  },
});
registry.registerPath({
  method: "post",
  path: "/users/me/tickets/{ticketId}/refund",
  tags: ["tickets"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ ticketId: ticketIdParam }),
    body: { content: { "application/json": { schema: refundRequestSchema } } },
  },
  responses: {
    200: json("Refund submitted", refundResponseSchema),
    400: commonErrors[400],
    401: commonErrors[401],
    404: commonErrors[404],
    409: commonErrors[409],
  },
});

// Belege
registry.registerPath({
  method: "post",
  path: "/users/me/tickets/{ticketId}/belege",
  tags: ["belege"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ ticketId: ticketIdParam }),
    body: {
      content: { "application/json": { schema: belegPresignRequestSchema } },
    },
  },
  responses: {
    200: json("Presigned POST envelope", belegPresignResponseSchema),
    400: commonErrors[400],
    401: commonErrors[401],
    409: commonErrors[409],
  },
});
registry.registerPath({
  method: "post",
  path: "/users/me/tickets/{ticketId}/belege/{belegId}/confirm",
  tags: ["belege"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ ticketId: ticketIdParam, belegId: belegIdParam }),
    body: {
      content: { "application/json": { schema: belegConfirmRequestSchema } },
    },
  },
  responses: {
    200: json("OK", belegConfirmResponseSchema),
    400: commonErrors[400],
    401: commonErrors[401],
    404: commonErrors[404],
  },
});
registry.registerPath({
  method: "delete",
  path: "/users/me/tickets/{ticketId}/belege/{belegId}",
  tags: ["belege"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ ticketId: ticketIdParam, belegId: belegIdParam }),
  },
  responses: {
    204: { description: "Deleted" },
    401: commonErrors[401],
    404: commonErrors[404],
  },
});

// Route templates
registry.registerPath({
  method: "get",
  path: "/users/me/route-templates",
  tags: ["route-templates"],
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: json("OK", listRouteTemplatesResponseSchema),
    401: commonErrors[401],
  },
});
registry.registerPath({
  method: "post",
  path: "/users/me/route-templates",
  tags: ["route-templates"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: createRouteTemplateRequestSchema },
      },
    },
  },
  responses: {
    201: json("Created", routeTemplateSchema),
    400: commonErrors[400],
    401: commonErrors[401],
    409: commonErrors[409],
  },
});
registry.registerPath({
  method: "patch",
  path: "/users/me/route-templates/{templateId}",
  tags: ["route-templates"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ templateId: templateIdParam }),
    body: {
      content: {
        "application/json": { schema: patchRouteTemplateRequestSchema },
      },
    },
  },
  responses: {
    200: json("OK", routeTemplateSchema),
    400: commonErrors[400],
    401: commonErrors[401],
    404: commonErrors[404],
  },
});
registry.registerPath({
  method: "delete",
  path: "/users/me/route-templates/{templateId}",
  tags: ["route-templates"],
  security: [{ [bearerAuth.name]: [] }],
  request: { params: z.object({ templateId: templateIdParam }) },
  responses: {
    204: { description: "Deleted" },
    401: commonErrors[401],
    404: commonErrors[404],
  },
});

// --- Admin --------------------------------------------------------------
registry.registerPath({
  method: "get",
  path: "/admin/stats",
  tags: ["admin"],
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: json("OK", adminStatsResponseSchema),
    401: commonErrors[401],
    403: commonErrors[403],
  },
});
registry.registerPath({
  method: "get",
  path: "/admin/users",
  tags: ["admin"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: z.object({
      email: z.string().optional(),
      user_state: z.string().optional(),
      limit: z.string().optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: json("OK", listUsersResponseSchema),
    401: commonErrors[401],
    403: commonErrors[403],
  },
});
registry.registerPath({
  method: "get",
  path: "/admin/users/{email}",
  tags: ["admin"],
  security: [{ [bearerAuth.name]: [] }],
  request: { params: z.object({ email: emailPathParam }) },
  responses: {
    200: json("OK", getAdminUserResponseSchema),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});
registry.registerPath({
  method: "patch",
  path: "/admin/users/{email}",
  tags: ["admin"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ email: emailPathParam }),
    body: {
      content: {
        "application/json": { schema: patchAdminUserRequestSchema },
      },
    },
  },
  responses: {
    200: json("OK", getAdminUserResponseSchema),
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});
registry.registerPath({
  method: "get",
  path: "/admin/tickets",
  tags: ["admin"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    query: z.object({
      state: z.string().optional(),
      email: z.string().optional(),
      trainNr: z.string().optional(),
      date: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.string().optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: json("OK", listAdminTicketsResponseSchema),
    401: commonErrors[401],
    403: commonErrors[403],
  },
});
registry.registerPath({
  method: "get",
  path: "/admin/tickets/{ticketId}",
  tags: ["admin"],
  security: [{ [bearerAuth.name]: [] }],
  request: { params: z.object({ ticketId: ticketIdParam }) },
  responses: {
    200: json("OK", getAdminTicketResponseSchema),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});
registry.registerPath({
  method: "patch",
  path: "/admin/tickets/{ticketId}",
  tags: ["admin"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ ticketId: ticketIdParam }),
    body: {
      content: {
        "application/json": { schema: patchAdminTicketRequestSchema },
      },
    },
  },
  responses: {
    200: json("OK", getAdminTicketResponseSchema),
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});
registry.registerPath({
  method: "get",
  path: "/admin/trains/{trainNr}/{date}/delays",
  tags: ["admin"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ trainNr: trainNrParam, date: dateParam }),
  },
  responses: {
    200: json("OK", delaysResponseSchema),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});

// SEPA
registry.registerPath({
  method: "get",
  path: "/admin/sepa/pending-batches",
  tags: ["admin", "sepa"],
  security: [{ [bearerAuth.name]: [] }],
  responses: {
    200: json("OK", getPendingBatchesResponseSchema),
    401: commonErrors[401],
    403: commonErrors[403],
  },
});
registry.registerPath({
  method: "post",
  path: "/admin/sepa/batches/{batchId}/mark-submitted",
  tags: ["admin", "sepa"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ batchId: batchIdParam }),
    body: {
      content: { "application/json": { schema: markSubmittedRequestSchema } },
    },
  },
  responses: {
    200: json("OK", markSubmittedResponseSchema),
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});
registry.registerPath({
  method: "post",
  path: "/admin/tickets/{ticketId}/pain008-rebuild",
  tags: ["admin", "sepa"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    params: z.object({ ticketId: ticketIdParam }),
    body: {
      content: { "application/json": { schema: pain008RebuildRequestSchema } },
    },
  },
  responses: {
    202: { description: "Rebuild triggered" },
    401: commonErrors[401],
    403: commonErrors[403],
    404: commonErrors[404],
  },
});
registry.registerPath({
  method: "post",
  path: "/admin/sepa/reports/upload",
  tags: ["admin", "sepa"],
  security: [{ [bearerAuth.name]: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: sepaReportUploadRequestSchema },
      },
    },
  },
  responses: {
    200: json("Presigned POST envelope", sepaReportUploadResponseSchema),
    400: commonErrors[400],
    401: commonErrors[401],
    403: commonErrors[403],
  },
});

// --- Emit ---------------------------------------------------------------
const generator = new OpenApiGeneratorV3(registry.definitions);
const doc = generator.generateDocument({
  openapi: "3.0.3",
  info: {
    title: "RailBack API",
    version: "0.1.0",
    description:
      "OpenAPI contract for the RailBack backend. Generated from zod schemas via @asteasolutions/zod-to-openapi. Commit this file — CI drift-checks it.",
  },
  servers: [
    {
      url: "https://{apiId}.execute-api.eu-north-1.amazonaws.com",
      description:
        "API Gateway HTTP API base. Replace {apiId} with the deployed API's id; region is eu-north-1.",
      variables: {
        apiId: { default: "example", description: "API Gateway HTTP API id" },
      },
    },
  ],
});

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "schema", "openapi.yaml");
const yamlText = yaml.dump(doc, { noRefs: false, lineWidth: 120, sortKeys: false });
writeFileSync(outPath, yamlText, "utf8");
process.stdout.write(`wrote ${outPath} (${yamlText.length} bytes)\n`);
