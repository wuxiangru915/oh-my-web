import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { invalidateModelsCache } from "./models-cache";

const MODEL_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeModelCost(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const providedKeys = MODEL_COST_KEYS.filter((key) => value[key] !== undefined);
  if (providedKeys.length === 0) return undefined;
  if (providedKeys.some((key) => (
    typeof value[key] !== "number" || !Number.isFinite(value[key])
  ))) return undefined;

  return Object.fromEntries([
    ...Object.entries(value),
    ...MODEL_COST_KEYS.map((key) => [key, value[key] ?? 0]),
  ]);
}

/** Complete partial cost groups with zero; omit a cost group only when it is empty. */
export function normalizeModelsConfigCosts(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = structuredClone(data);
  if (!isRecord(normalized.providers)) return normalized;

  for (const provider of Object.values(normalized.providers)) {
    if (!isRecord(provider) || !Array.isArray(provider.models)) continue;
    for (const model of provider.models) {
      if (!isRecord(model) || !("cost" in model)) continue;
      const cost = normalizeModelCost(model.cost);
      if (cost) model.cost = cost;
      else delete model.cost;
    }
  }
  return normalized;
}

function sanitizeModelsConfig(data: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(data.providers)) return data;

  const providers = Object.fromEntries(Object.entries(data.providers).map(([providerId, provider]) => {
    if (!isRecord(provider) || !Array.isArray(provider.models)) return [providerId, provider];
    const models = provider.models.filter((model) => (
      !isRecord(model) || typeof model.id !== "string" || model.id.trim().length > 0
    ));
    const sanitizedProvider: Record<string, unknown> = { ...provider, models };
    if (typeof sanitizedProvider.proxy === "string") {
      const trimmed = sanitizedProvider.proxy.trim();
      if (trimmed.length > 0) sanitizedProvider.proxy = trimmed;
      else delete sanitizedProvider.proxy;
    }
    return [providerId, sanitizedProvider];
  }));

  return { ...data, providers };
}

export function getModelsConfigPath(): string {
  return join(getAgentDir(), "models.json");
}

export function readModelsConfig(
  modelsPath = getModelsConfigPath(),
): Record<string, unknown> {
  if (!existsSync(modelsPath)) return { providers: {} };
  try {
    return JSON.parse(readFileSync(modelsPath, "utf8")) as Record<string, unknown>;
  } catch {
    return { providers: {} };
  }
}

export function getSettingsConfigPath(modelsPath = getModelsConfigPath()): string {
  return join(dirname(modelsPath), "settings.json");
}

export function syncSettingsForModelsConfig(
  oldProviderIds: string[],
  newConfig: Record<string, unknown>,
  settingsPath = getSettingsConfigPath(),
): void {
  if (!existsSync(settingsPath)) return;
  try {
    const raw = readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    let modified = false;

    const newProviders = (isRecord(newConfig.providers) ? newConfig.providers : {}) as Record<string, unknown>;
    const newProviderIds = Object.keys(newProviders);

    if (Array.isArray(settings.enabledModels)) {
      const removed = oldProviderIds.filter((p) => !newProviderIds.includes(p));
      let enabledModels = [...(settings.enabledModels as string[])];

      for (const p of removed) {
        const next = enabledModels.filter(
          (pat) => pat !== `${p}/*` && pat !== p && !pat.startsWith(`${p}/`) && !pat.startsWith(`${p}:`),
        );
        if (next.length !== enabledModels.length) {
          enabledModels = next;
          modified = true;
        }
      }

      for (const [providerId, providerEntry] of Object.entries(newProviders)) {
        if (!isRecord(providerEntry)) continue;
        const models = Array.isArray(providerEntry.models)
          ? providerEntry.models.filter((m) => isRecord(m) && typeof m.id === "string" && m.id.trim().length > 0)
          : [];

        if (models.length > 0) {
          const modelPatterns = models.map((m) => `${providerId}/${(m as { id: string }).id.trim()}`);
          const withoutProvider = enabledModels.filter(
            (pat) => pat !== `${providerId}/*` && pat !== providerId && !pat.startsWith(`${providerId}/`) && !pat.startsWith(`${providerId}:`),
          );
          const next = [...withoutProvider, ...modelPatterns];
          if (JSON.stringify(next) !== JSON.stringify(enabledModels)) {
            enabledModels = next;
            modified = true;
          }
        } else {
          const hasPattern = enabledModels.some(
            (pat) => pat === `${providerId}/*` || pat === providerId || pat.startsWith(`${providerId}/`) || pat.startsWith(`${providerId}:`),
          );
          if (!hasPattern) {
            enabledModels.push(`${providerId}/*`);
            modified = true;
          }
        }
      }

      if (modified) {
        settings.enabledModels = enabledModels;
      }
    }

    const removed = oldProviderIds.filter((p) => !newProviderIds.includes(p));
    if (typeof settings.defaultProvider === "string" && removed.includes(settings.defaultProvider)) {
      delete settings.defaultProvider;
      delete settings.defaultModel;
      modified = true;
    }

    if (modified) {
      writePrivateFileAtomicSync(settingsPath, JSON.stringify(settings, null, 2));
    }
  } catch {
    // Ignore settings synchronization failures
  }
}

export function syncSettingsForProviderAuth(
  provider: string,
  action: "added" | "removed",
  settingsPath = getSettingsConfigPath(),
): void {
  if (!existsSync(settingsPath)) return;
  try {
    const raw = readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    let modified = false;

    if (Array.isArray(settings.enabledModels)) {
      let enabledModels = [...(settings.enabledModels as string[])];
      if (action === "added") {
        const hasPattern = enabledModels.some(
          (pat) => pat === `${provider}/*` || pat === provider || pat.startsWith(`${provider}/`) || pat.startsWith(`${provider}:`),
        );
        if (!hasPattern) {
          enabledModels.push(`${provider}/*`);
          modified = true;
        }
      } else if (action === "removed") {
        const next = enabledModels.filter(
          (pat) => pat !== `${provider}/*` && pat !== provider && !pat.startsWith(`${provider}/`) && !pat.startsWith(`${provider}:`),
        );
        if (next.length !== enabledModels.length) {
          enabledModels = next;
          modified = true;
        }
      }

      if (modified) {
        settings.enabledModels = enabledModels;
      }
    }

    if (action === "removed" && settings.defaultProvider === provider) {
      delete settings.defaultProvider;
      delete settings.defaultModel;
      modified = true;
    }

    if (modified) {
      writePrivateFileAtomicSync(settingsPath, JSON.stringify(settings, null, 2));
    }
  } catch {
    // Ignore settings synchronization failures
  }
}

export function writeModelsConfig(
  data: Record<string, unknown>,
  modelsPath = getModelsConfigPath(),
  settingsPath = getSettingsConfigPath(modelsPath),
): void {
  const dir = dirname(modelsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const oldConfig = readModelsConfig(modelsPath);
  const oldProviderIds = isRecord(oldConfig.providers) ? Object.keys(oldConfig.providers) : [];
  const normalized = normalizeModelsConfigCosts(sanitizeModelsConfig(data));
  writePrivateFileAtomicSync(modelsPath, JSON.stringify(normalized, null, 2));
  syncSettingsForModelsConfig(oldProviderIds, normalized, settingsPath);
  invalidateModelsCache();
}
