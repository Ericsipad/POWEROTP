export interface PowerOtpWidgetOptions {
  container: HTMLElement;
  interactionToken: string;
  widgetUrl?: string;
  title?: string;
}

export interface PowerOtpWidgetHandle {
  destroy(): void;
}

export function mountPowerOtpWidget(
  options: PowerOtpWidgetOptions,
): PowerOtpWidgetHandle {
  const widgetUrl = new URL(
    options.widgetUrl ?? "https://powerotp.com/widget",
  );
  if (widgetUrl.protocol !== "https:") {
    throw new Error("POWEROTP widgetUrl must use HTTPS");
  }
  if (!options.interactionToken) {
    throw new Error("POWEROTP interactionToken is required");
  }

  widgetUrl.hash = new URLSearchParams({
    interactionToken: options.interactionToken,
    parentOrigin: window.location.origin,
  }).toString();

  const frame = document.createElement("iframe");
  frame.src = widgetUrl.toString();
  frame.title = options.title ?? "POWEROTP verification";
  frame.referrerPolicy = "no-referrer";
  frame.sandbox.add("allow-forms", "allow-scripts", "allow-same-origin");
  frame.allow = "none";
  frame.style.border = "0";
  frame.style.width = "100%";

  options.container.replaceChildren(frame);

  return {
    destroy() {
      frame.remove();
    },
  };
}
