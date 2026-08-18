"use client";

import {
  createGateBrowserCoordinator,
  type GateBrowserCoordinator,
  type GateBrowserOptions,
} from "@powerotp/gate-node/browser";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

type GateSnapshot = ReturnType<GateBrowserCoordinator["getSnapshot"]>;

export interface PowerOtpNextProviderProps {
  children?: ReactNode;
  sensorVersion: string;
  pollIntervalMs?: number;
  window?: Window;
  document?: Document;
  fetch?: typeof fetch;
  initialProofs?: GateBrowserOptions["initialProofs"];
  fingerprintCollector?: GateBrowserOptions["fingerprintCollector"];
  initialSnapshot?: GateSnapshot;
  onError?: (code: "bootstrap" | "bridge") => void;
}

export interface PowerOtpNextValue {
  snapshot: GateSnapshot;
  openOtp(): Promise<boolean>;
}

interface GateStore {
  getSnapshot(): GateSnapshot;
  subscribe(listener: () => void): () => void;
  openOtp(): Promise<boolean>;
  attach(coordinator: GateBrowserCoordinator): void;
  dispose(): void;
}

const unavailableSnapshot: GateSnapshot = {
  lifecycle: "unavailable",
  recommendation: "full_access",
  decisionPending: false,
  otpOpen: false,
};

const unavailableStore = createGateStore(unavailableSnapshot);
const PowerOtpContext = createContext<GateStore>(unavailableStore);

export function PowerOtpNextProvider({
  children,
  sensorVersion,
  pollIntervalMs,
  window: suppliedWindow,
  document: suppliedDocument,
  fetch: suppliedFetch,
  initialProofs,
  fingerprintCollector,
  initialSnapshot,
  onError,
}: PowerOtpNextProviderProps) {
  const storeRef = useRef<GateStore | undefined>(undefined);
  storeRef.current ??= createGateStore(initialSnapshot ?? unavailableSnapshot);
  const store = storeRef.current;

  useEffect(() => {
    const browserWindow = suppliedWindow ?? globalThis.window;
    const browserDocument = suppliedDocument ?? globalThis.document;
    if (!browserWindow || !browserDocument) return;

    let disposed = false;
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
        store.attach(created);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      store.dispose();
    };
  }, [
    initialProofs,
    fingerprintCollector,
    onError,
    pollIntervalMs,
    sensorVersion,
    store,
    suppliedDocument,
    suppliedFetch,
    suppliedWindow,
  ]);

  return <PowerOtpContext value={store}>{children}</PowerOtpContext>;
}

export type PowerOtpNextGateProps = Omit<PowerOtpNextProviderProps, "children" | "initialSnapshot">;

export function PowerOtpNextGate(props: PowerOtpNextGateProps) {
  return <PowerOtpNextProvider {...props} />;
}

export function usePowerOtp(): PowerOtpNextValue {
  const store = useContext(PowerOtpContext);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return { snapshot, openOtp: store.openOtp };
}

function createGateStore(initialSnapshot: GateSnapshot): GateStore {
  let snapshot = initialSnapshot;
  let coordinator: GateBrowserCoordinator | undefined;
  let unsubscribe: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = () => {
    if (coordinator) snapshot = coordinator.getSnapshot();
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openOtp: () => coordinator?.openOtp() ?? Promise.resolve(false),
    attach(created) {
      unsubscribe?.();
      coordinator?.dispose();
      coordinator = created;
      snapshot = created.getSnapshot();
      unsubscribe = created.subscribe(publish);
      publish();
      created.start();
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = undefined;
      coordinator?.dispose();
      coordinator = undefined;
    },
  };
}
