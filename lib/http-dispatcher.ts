import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import * as undici from "undici";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

type DispatcherGlobal = typeof globalThis & {
  __piWebHttpDispatcherConfigured?: boolean;
};

const dispatcherGlobal = globalThis as DispatcherGlobal;
const originalGlobalFetch = globalThis.fetch;
const ignoreUndiciDispatcherError = (): void => {};

function parseHttpIdleTimeoutMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === "disabled") return 0;
    if (trimmed.length === 0) return undefined;
    return parseHttpIdleTimeoutMs(Number(trimmed));
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

// Undici can emit an internal Client error while terminating a response body.
// The body stream still rejects; this prevents the EventEmitter error from
// terminating the Next.js process first.
function withUndiciErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
  }
  return dispatcher;
}

function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
  return withUndiciErrorListener(
    new undici.Client(origin, options as undici.Client.Options),
  );
}

function createUndiciOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  const dispatcherOptions = options as undici.Pool.Options;
  if (dispatcherOptions.connections === 1) {
    return createUndiciClient(origin, dispatcherOptions);
  }

  return withUndiciErrorListener(
    new undici.Pool(origin, {
      ...dispatcherOptions,
      factory: createUndiciClient,
    }),
  );
}

function loadProxiesFromFile(filePath: string, proxyMap: Map<string, string>): void {
  if (!existsSync(filePath)) return;
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    if (data && typeof data === "object" && typeof data.providers === "object" && data.providers !== null) {
      for (const prov of Object.values(data.providers)) {
        if (prov && typeof prov === "object") {
          const providerObj = prov as { proxy?: unknown; baseUrl?: unknown };
          if (typeof providerObj.proxy === "string") {
            const proxy = providerObj.proxy.trim();
            if (!proxy) continue;
            if (typeof providerObj.baseUrl === "string" && providerObj.baseUrl.trim()) {
              try {
                const url = new URL(providerObj.baseUrl.trim());
                proxyMap.set(url.origin.toLowerCase(), proxy);
                proxyMap.set(url.host.toLowerCase(), proxy);
              } catch {
                // Ignore invalid baseUrl URL
              }
            }
          }
        }
      }
    }
  } catch {
    // Ignore read/parse errors
  }
}

export function getProviderProxyMap(): Map<string, string> {
  const proxyMap = new Map<string, string>();
  try {
    const primaryPath = join(getAgentDir(), "models.json");
    loadProxiesFromFile(primaryPath, proxyMap);
  } catch {
    // Ignore getAgentDir error
  }

  // Fallback to ~/.pi/agent/models.json if empty
  if (proxyMap.size === 0) {
    try {
      const fallbackPath = join(homedir(), ".pi", "agent", "models.json");
      loadProxiesFromFile(fallbackPath, proxyMap);
    } catch {
      // Ignore fallback error
    }
  }

  return proxyMap;
}

class DynamicProxyDispatcher extends undici.Dispatcher {
  private defaultDispatcher: undici.Dispatcher;
  private proxyAgents = new Map<string, undici.Dispatcher>();
  private timeoutMs: number;

  constructor(defaultDispatcher: undici.Dispatcher, timeoutMs: number) {
    super();
    this.defaultDispatcher = defaultDispatcher;
    this.timeoutMs = timeoutMs;
  }

  private getProxyAgent(proxyUrl: string): undici.Dispatcher {
    let agent = this.proxyAgents.get(proxyUrl);
    if (!agent) {
      agent = withUndiciErrorListener(
        new undici.ProxyAgent({
          uri: proxyUrl,
          allowH2: false,
          bodyTimeout: this.timeoutMs,
          headersTimeout: this.timeoutMs,
          clientFactory: createUndiciClient,
          factory: createUndiciOriginDispatcher,
        }),
      );
      this.proxyAgents.set(proxyUrl, agent);
    }
    return agent;
  }

  override dispatch(options: undici.Dispatcher.DispatchOptions, handler: undici.Dispatcher.DispatchHandler): boolean {
    const origin = typeof options.origin === "string"
      ? options.origin
      : options.origin?.origin || options.origin?.toString();

    if (origin) {
      const proxyMap = getProviderProxyMap();
      let matchedProxy: string | undefined;
      try {
        const url = new URL(origin);
        matchedProxy = proxyMap.get(url.origin.toLowerCase()) || proxyMap.get(url.host.toLowerCase());
      } catch {
        matchedProxy = proxyMap.get(origin.toLowerCase());
      }

      if (matchedProxy) {
        return this.getProxyAgent(matchedProxy).dispatch(options, handler);
      }
    }

    return this.defaultDispatcher.dispatch(options, handler);
  }

  override close(): Promise<void> {
    const promises: Promise<void>[] = [this.defaultDispatcher.close()];
    for (const agent of this.proxyAgents.values()) {
      promises.push(agent.close());
    }
    return Promise.all(promises).then(() => {});
  }

  override destroy(): Promise<void> {
    const promises: Promise<void>[] = [this.defaultDispatcher.destroy()];
    for (const agent of this.proxyAgents.values()) {
      promises.push(agent.destroy());
    }
    return Promise.all(promises).then(() => {});
  }
}

export function configureHttpDispatcher(
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): void {
  if (dispatcherGlobal.__piWebHttpDispatcherConfigured) return;

  const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === undefined) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
  }

  const baseDispatcher = withUndiciErrorListener(
    new undici.EnvHttpProxyAgent({
      allowH2: false,
      bodyTimeout: normalizedTimeoutMs,
      headersTimeout: normalizedTimeoutMs,
      clientFactory: createUndiciClient,
      factory: createUndiciOriginDispatcher,
    }),
  );

  const dispatcher = withUndiciErrorListener(
    new DynamicProxyDispatcher(baseDispatcher, normalizedTimeoutMs),
  );

  undici.setGlobalDispatcher(dispatcher);

  // Keep fetch and the dispatcher on the same undici implementation. Preserve
  // an intentional fetch override installed after this module was loaded.
  if (globalThis.fetch === originalGlobalFetch) {
    undici.install?.();
  }

  dispatcherGlobal.__piWebHttpDispatcherConfigured = true;
}
