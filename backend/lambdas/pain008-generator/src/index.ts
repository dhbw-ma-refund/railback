// Public entry-point. admin-handler dynamic-imports this module via
// `await import("@railback/pain008-generator")` and calls `generatePain008`.

export { generatePain008 } from "./handler.js";
export type { GeneratePain008Args } from "./handler.js";
