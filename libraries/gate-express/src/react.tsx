import {
  createGateBrowserCoordinator,
  type GateBrowserOptions,
} from "@powerotp/gate-node/browser";
import { useEffect } from "react";

export interface PowerOtpBrowserGateProps {
  sensorVersion: string;
  pollIntervalMs?: number;
  window?: Window;
  document?: Document;
  fetch?: typeof fetch;
  initialProofs?: GateBrowserOptions["initialProofs"];
  fingerprintCollector?: GateBrowserOptions["fingerprintCollector"];
  onError?: (code: "bootstrap" | "bridge") => void;
}

export function PowerOtpBrowserGate({
  sensorVersion,
  pollIntervalMs,
  window: suppliedWindow,
  document: suppliedDocument,
  fetch: suppliedFetch,
  initialProofs,
  fingerprintCollector,
  onError,
}: PowerOtpBrowserGateProps) {
  useEffect(() => {
    const browserWindow = suppliedWindow ?? globalThis.window;
    const browserDocument = suppliedDocument ?? globalThis.document;
    if (!browserWindow || !browserDocument) return;

    let disposed = false;
    let coordinator: Awaited<ReturnType<typeof createGateBrowserCoordinator>> | undefined;
    void createGateBrowserCoordinator({
      window: browserWindow,
      document: browserDocument,
      sensorVersion,
      ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
      ...(suppliedFetch ? { fetch: suppliedFetch } : {}),
      ...(initialProofs ? { initialProofs } : {}),
      ...(fingerprintCollector ? { fingerprintCollector } : {}),
      ...(onError ? { onError } : {}),
    })
      .then((created) => {
        if (disposed) {
          created.dispose();
          return;
        }
        coordinator = created;
        created.start();
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      coordinator?.dispose();
    };
  }, [
    onError,
    fingerprintCollector,
    initialProofs,
    pollIntervalMs,
    sensorVersion,
    suppliedDocument,
    suppliedFetch,
    suppliedWindow,
  ]);

  return null;
}
