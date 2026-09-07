import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import type { PiUpdatePerformResponse, PiUpdateResponse } from "./api-types";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const NPM_PI_LATEST_URL = "https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest";
const PI_DEV_LATEST_URL = "https://pi.dev/api/latest-version";
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface VersionCache {
  latestVersion?: string;
  expiresAt: number;
  inFlight?: Promise<string>;
}

declare global {
  var __piVersionCache: VersionCache | undefined;
  var __piUpdateLock: boolean | undefined;
}

function getCache(): VersionCache {
  return (globalThis.__piVersionCache ??= { expiresAt: 0 });
}

export function parseVersionParts(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
    return null;
  }
  return [major, minor, patch];
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const candParts = parseVersionParts(candidate);
  const currParts = parseVersionParts(current);
  if (!candParts || !currParts) return false;
  for (let i = 0; i < 3; i++) {
    if (candParts[i] > currParts[i]) return true;
    if (candParts[i] < currParts[i]) return false;
  }
  return false;
}

export function getInstalledPiVersion(cwd: string = process.cwd()): string {
  try {
    const pkgPath = join(cwd, "node_modules/@earendil-works/pi-coding-agent/package.json");
    if (existsSync(pkgPath)) {
      const data = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: unknown };
      if (typeof data.version === "string" && data.version.trim()) {
        return data.version.trim();
      }
    }
  } catch {
    // ignore
  }

  try {
    const rootPkgPath = join(cwd, "package.json");
    if (existsSync(rootPkgPath)) {
      const data = JSON.parse(readFileSync(rootPkgPath, "utf-8")) as {
        dependencies?: Record<string, string>;
      };
      const depVer = data.dependencies?.["@earendil-works/pi-coding-agent"];
      if (depVer) {
        return depVer.replace(/^[\^~]/, "").trim();
      }
    }
  } catch {
    // ignore
  }

  return "0.0.0";
}

export async function getSystemPiCliVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("pi", ["--version"], { timeout: 3000 });
    const trimmed = stdout.trim();
    if (trimmed && parseVersionParts(trimmed)) {
      return trimmed;
    }
  } catch {
    // pi not installed globally or in PATH
  }
  return null;
}

export async function fetchLatestPiVersion(): Promise<string> {
  try {
    const res = await fetch(NPM_PI_LATEST_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = (await res.json()) as { version?: unknown };
      if (typeof data.version === "string" && data.version.trim()) {
        return data.version.trim();
      }
    }
  } catch {
    // try fallback
  }

  try {
    const res = await fetch(PI_DEV_LATEST_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.ok) {
      const data = (await res.json()) as { version?: unknown };
      if (typeof data.version === "string" && data.version.trim()) {
        return data.version.trim();
      }
    }
  } catch {
    // fallback failed
  }

  throw new Error("Failed to fetch latest pi version from registry");
}

async function resolveLatestVersion(force = false): Promise<string> {
  const cache = getCache();
  if (!force && cache.latestVersion && cache.expiresAt > Date.now()) {
    return cache.latestVersion;
  }
  if (!cache.inFlight) {
    cache.inFlight = fetchLatestPiVersion()
      .then((ver) => {
        cache.latestVersion = ver;
        cache.expiresAt = Date.now() + CACHE_TTL_MS;
        return ver;
      })
      .finally(() => {
        cache.inFlight = undefined;
      });
  }
  return cache.inFlight;
}

export async function checkPiUpdate(force = false, cwd: string = process.cwd()): Promise<PiUpdateResponse> {
  const currentVersion = getInstalledPiVersion(cwd);
  const cliVersion = await getSystemPiCliVersion();

  let latestVersion = currentVersion;
  try {
    latestVersion = await resolveLatestVersion(force);
  } catch {
    if (cliVersion && isNewerVersion(cliVersion, currentVersion)) {
      latestVersion = cliVersion;
    }
  }

  const updateAvailable =
    isNewerVersion(latestVersion, currentVersion) ||
    Boolean(cliVersion && isNewerVersion(cliVersion, currentVersion));

  return {
    currentVersion,
    cliVersion,
    latestVersion,
    updateAvailable,
  };
}

export async function performPiUpdate(cwd: string = process.cwd()): Promise<PiUpdatePerformResponse> {
  if (globalThis.__piUpdateLock) {
    throw new Error("Update is already in progress");
  }

  globalThis.__piUpdateLock = true;
  try {
    const previousVersion = getInstalledPiVersion(cwd);
    const packages = [
      "@earendil-works/pi-agent-core@latest",
      "@earendil-works/pi-ai@latest",
      "@earendil-works/pi-coding-agent@latest",
      "@earendil-works/pi-tui@latest",
    ];

    const installCommand = `npm install --no-audit --no-fund ${packages.join(" ")}`;
    await execAsync(installCommand, {
      cwd,
      timeout: 120_000,
    });

    let cliUpdated = false;
    try {
      await execAsync("pi update", { timeout: 30_000 });
      cliUpdated = true;
    } catch {
      // Best-effort CLI update; non-fatal if permissions or CLI unavailable
    }

    // Clear cache so next status check is fresh
    const cache = getCache();
    cache.expiresAt = 0;
    cache.latestVersion = undefined;

    const newVersion = getInstalledPiVersion(cwd);

    return {
      success: true,
      previousVersion,
      newVersion,
      cliUpdated,
      message: `pi updated from v${previousVersion} to v${newVersion}`,
    };
  } finally {
    globalThis.__piUpdateLock = false;
  }
}
