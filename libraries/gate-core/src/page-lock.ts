export interface PageLockOptions {
  document: Document;
  challengeUrl: string;
  allowedChallengeOrigin: string;
  title?: string;
}

export interface PageLock {
  freeze(): void;
  unfreeze(): void;
  isFrozen(): boolean;
  getMessageSource(): WindowProxy | null;
}

interface HiddenElement {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
}

export function createPageLock(options: PageLockOptions): PageLock {
  const challengeUrl = new URL(options.challengeUrl);
  const allowedOrigin = new URL(options.allowedChallengeOrigin);
  if (challengeUrl.protocol !== "https:" || challengeUrl.username || challengeUrl.password) {
    throw new Error("BotBlocker challenge URL must be credential-free HTTPS");
  }
  if (
    allowedOrigin.protocol !== "https:" ||
    allowedOrigin.username ||
    allowedOrigin.password ||
    challengeUrl.origin !== allowedOrigin.origin
  ) {
    throw new Error("BotBlocker challenge URL must use the approved HTTPS origin");
  }

  let overlay: HTMLDivElement | undefined;
  let frame: HTMLIFrameElement | undefined;
  let previousFocus: HTMLElement | undefined;
  let previousOverflow = "";
  let hiddenElements: HiddenElement[] = [];
  let observer: MutationObserver | undefined;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (!overlay) return;
    if (event.key === "Tab" || event.key === "Escape") {
      event.preventDefault();
      frame?.focus();
    }
  };

  return {
    freeze() {
      if (overlay) return;
      const { document } = options;
      if (!document.body) throw new Error("BotBlocker page lock requires document.body");
      const HTMLElementConstructor = document.defaultView?.HTMLElement;

      previousFocus =
        HTMLElementConstructor && document.activeElement instanceof HTMLElementConstructor
          ? document.activeElement
          : undefined;
      previousOverflow = document.body.style.overflow;
      hiddenElements = Array.from(document.body.children)
        .filter(
          (element): element is HTMLElement =>
            Boolean(HTMLElementConstructor && element instanceof HTMLElementConstructor),
        )
        .map((element) => ({
          element,
          inert: element.inert,
          ariaHidden: element.getAttribute("aria-hidden"),
        }));

      for (const hidden of hiddenElements) {
        hidden.element.inert = true;
        hidden.element.setAttribute("aria-hidden", "true");
      }

      overlay = document.createElement("div");
      overlay.dataset.powerotpBotblockerLock = "true";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", options.title ?? "POWEROTP verification required");
      Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483647",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.72)",
      });

      frame = document.createElement("iframe");
      frame.src = challengeUrl.toString();
      frame.title = options.title ?? "POWEROTP verification";
      frame.referrerPolicy = "no-referrer";
      frame.sandbox.add("allow-forms", "allow-scripts", "allow-same-origin");
      frame.allow = "none";
      frame.tabIndex = 0;
      Object.assign(frame.style, {
        border: "0",
        width: "min(100%, 32rem)",
        height: "min(100%, 44rem)",
        background: "white",
      });

      overlay.append(frame);
      document.body.append(overlay);
      const hideNewElement = (element: HTMLElement) => {
        if (element === overlay || hiddenElements.some((hidden) => hidden.element === element)) return;
        hiddenElements.push({
          element,
          inert: element.inert,
          ariaHidden: element.getAttribute("aria-hidden"),
        });
        element.inert = true;
        element.setAttribute("aria-hidden", "true");
      };
      const MutationObserverConstructor = document.defaultView?.MutationObserver;
      if (MutationObserverConstructor) {
        observer = new MutationObserverConstructor((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (HTMLElementConstructor && node instanceof HTMLElementConstructor) {
                hideNewElement(node);
              }
            }
          }
        });
        observer.observe(document.body, { childList: true });
      }
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", handleKeyDown, true);
      frame.focus();
    },

    unfreeze() {
      if (!overlay) return;
      const { document } = options;
      observer?.disconnect();
      observer = undefined;
      document.removeEventListener("keydown", handleKeyDown, true);
      overlay.remove();
      overlay = undefined;
      frame = undefined;
      document.body.style.overflow = previousOverflow;

      for (const hidden of hiddenElements) {
        hidden.element.inert = hidden.inert;
        if (hidden.ariaHidden === null) hidden.element.removeAttribute("aria-hidden");
        else hidden.element.setAttribute("aria-hidden", hidden.ariaHidden);
      }
      hiddenElements = [];
      if (previousFocus?.isConnected) previousFocus.focus();
      previousFocus = undefined;
    },

    isFrozen: () => overlay !== undefined,
    getMessageSource: () => frame?.contentWindow ?? null,
  };
}
