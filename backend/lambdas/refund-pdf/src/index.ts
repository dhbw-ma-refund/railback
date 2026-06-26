// Public entry-point. user-handler dynamic-imports this module via
// `await import("@railback/refund-pdf")` and calls `renderAndSend`.

export { renderAndSend } from "./handler.js";
export type { RenderAndSendArgs } from "./handler.js";
