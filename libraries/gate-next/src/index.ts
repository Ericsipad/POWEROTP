export {
  createPowerOtpNext,
  type GateNextOptions,
  type PowerOtpNextAdapter,
  type PowerOtpRequestHeaders,
} from "./adapter.js";
export { withPowerOtpFrameSource } from "./csp.js";
export type {
  GateNodeEvent,
  GateNodeLimits,
  GateNodeServices,
  GateSession,
  GateSessionStore,
  ProtectedRequestState,
  TrustedProxyConfig,
} from "@powerotp/gate-node";

/**
 * Copy this literal into proxy.ts. Next.js requires matcher values to be statically analyzable,
 * so an imported constant cannot be used as the exported config.matcher value.
 */
export const POWEROTP_PROXY_MATCHER =
  "/((?!_next/static|_next/image|_next/webpack-hmr|_powerotp(?:/|$)|\\.well-known/powerotp-agent(?:/|$)|health(?:/|$)|healthz$|ready$|readyz$|live$|livez$|\\.well-known/health(?:/|$)|assets(?:/|$)|static(?:/|$)|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|.*\\.(?:avif|bmp|css|eot|gif|ico|jpe?g|js|json|map|mp4|pdf|png|svg|ttf|txt|webmanifest|webp|woff2?)$).*)";
