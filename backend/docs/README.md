# API Documentation

The RailBack backend API reference.

- **`api.html`** — the deliverable. A single self-contained HTML file
  (Redoc). Open it in any browser; no server, build step, or internet
  connection required. Lists every endpoint with request/response shapes,
  auth requirements, and status codes.
- The underlying spec is `../schema/openapi.yaml` (OpenAPI 3.0.3),
  generated from the zod schemas in `lib/` — so the docs cannot drift
  from the actual code.

## Regenerating

From `railback/backend/`:

```
npm run docs:html
```

This regenerates `schema/openapi.yaml` from the zod schemas and rebuilds
`docs/api.html`. Run it after any change to request/response schemas or
routes.

To only refresh the spec (without the HTML), use `npm run generate:openapi`.
CI drift is guarded by `npm run check:openapi-drift`.

## Viewing the raw spec

`schema/openapi.yaml` can also be pasted into <https://editor.swagger.io>
or opened with any OpenAPI tool if a different renderer is preferred.
