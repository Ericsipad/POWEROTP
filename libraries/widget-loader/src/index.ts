/**
 * Mounts the hosted POWEROTP verification modal
 * (`frontend/app/widget/[sessionId]/page.tsx`) in an iframe. The `modalUrl`
 * comes from a customer's own backend calling
 * `POST /v1/projects/{slug}/modal-sessions` with its project API key (see
 * `@powerotp/server-sdk`'s `createModalSession`) — never a raw interaction
 * token, since a modal session is created *before* the end user has typed
 * their own phone number, and therefore before any interaction exists at
 * all. See `docs/AS_BUILT.md`'s "Hosted verification modal" section.
 */
export interface PowerOtpWidgetOptions {
  container: HTMLElement;
  modalUrl: string;
  title?: string;
  /** Called for every `message` event the modal iframe posts to this
   * window — e.g. `{ source: "powerotp-widget", state, reasonCode }` once
   * the verification reaches a terminal state. This is a same-page UX
   * signal only; it is never authoritative and must never be used to make
   * a security decision — always confirm any sensitive outcome through
   * the project's own signed server-to-server callback instead. */
  onEvent?(data: unknown): void;
}

export interface PowerOtpWidgetHandle {
  destroy(): void;
}

export function mountPowerOtpWidget(options: PowerOtpWidgetOptions): PowerOtpWidgetHandle {
  const widgetUrl = new URL(options.modalUrl);
  if (widgetUrl.protocol !== "https:") {
    throw new Error("POWEROTP modalUrl must use HTTPS");
  }

  const frame = document.createElement("iframe");
  frame.src = widgetUrl.toString();
  frame.title = options.title ?? "POWEROTP verification";
  frame.referrerPolicy = "no-referrer";
  frame.sandbox.add("allow-forms", "allow-scripts", "allow-same-origin");
  frame.allow = "none";
  frame.style.border = "0";
  frame.style.width = "100%";

  function handleMessage(event: MessageEvent) {
    if (event.source !== frame.contentWindow) return;
    options.onEvent?.(event.data);
  }
  window.addEventListener("message", handleMessage);

  options.container.replaceChildren(frame);

  return {
    destroy() {
      window.removeEventListener("message", handleMessage);
      frame.remove();
    },
  };
}
