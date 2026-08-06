import { EventEmitter } from "node:events";

export interface AriChannelEvent {
  type: string;
  channel?: { id: string; state?: string };
  cause?: number;
}

const RECONNECT_DELAY_MS = 5_000;

/**
 * Thin wrapper over Asterisk's local-only ARI (bound to 127.0.0.1, never
 * exposed publicly — see `docs/AS_BUILT.md`). Maintains one persistent
 * WebSocket subscription for the agent's Stasis app and exposes the two
 * REST calls call-control needs (originate, hangup). `subscribeAll` is
 * required: an originated channel does not enter the Stasis app (and
 * therefore isn't scoped to it) until it is answered, so call-progress and
 * failure events for channels that never answer only arrive with a
 * system-wide subscription. Node's built-in `fetch`/`WebSocket` (stable
 * since Node 22) are used instead of adding an ARI client dependency.
 */
export class AriClient extends EventEmitter {
  #ws?: WebSocket;
  #reconnectTimer?: NodeJS.Timeout;
  #closed = true;
  #open = false;

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string,
    private readonly appName: string,
  ) {
    super();
  }

  connect() {
    this.#closed = false;
    this.#connectOnce();
  }

  close() {
    this.#closed = true;
    clearTimeout(this.#reconnectTimer);
    this.#ws?.close();
  }

  isOpen(): boolean {
    return this.#open;
  }

  async originate(endpoint: string, channelId: string, timeoutSeconds: number): Promise<void> {
    const url = new URL("/ari/channels", this.baseUrl);
    url.searchParams.set("endpoint", endpoint);
    url.searchParams.set("app", this.appName);
    url.searchParams.set("channelId", channelId);
    url.searchParams.set("timeout", String(timeoutSeconds));

    const response = await fetch(url, { method: "POST", headers: this.#authHeader() });
    if (!response.ok) {
      throw new Error(`ARI originate failed: ${response.status}`);
    }
  }

  async hangup(channelId: string): Promise<void> {
    const url = new URL(`/ari/channels/${channelId}`, this.baseUrl);
    await fetch(url, { method: "DELETE", headers: this.#authHeader() }).catch(() => undefined);
  }

  #connectOnce() {
    const wsUrl = new URL("/ari/events", this.baseUrl.replace(/^http/, "ws"));
    wsUrl.searchParams.set("app", this.appName);
    wsUrl.searchParams.set("subscribeAll", "true");
    wsUrl.searchParams.set("api_key", `${this.username}:${this.password}`);

    const ws = new WebSocket(wsUrl);
    this.#ws = ws;
    ws.addEventListener("open", () => {
      this.#open = true;
    });
    ws.addEventListener("message", (message) => {
      try {
        this.emit("event", JSON.parse(String(message.data)) as AriChannelEvent);
      } catch {
        // Malformed frame; nothing usable to act on.
      }
    });
    ws.addEventListener("close", () => this.#scheduleReconnect());
    ws.addEventListener("error", () => this.#scheduleReconnect());
  }

  #scheduleReconnect() {
    this.#open = false;
    if (this.#closed) return;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = setTimeout(() => this.#connectOnce(), RECONNECT_DELAY_MS);
  }

  #authHeader(): Record<string, string> {
    const encoded = Buffer.from(`${this.username}:${this.password}`).toString("base64");
    return { authorization: `Basic ${encoded}` };
  }
}
