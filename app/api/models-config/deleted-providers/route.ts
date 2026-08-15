import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";

export const dynamic = "force-dynamic";

function getDeletedProvidersPath(): string {
  return path.join(getAgentDir(), "deleted-providers.json");
}

function readDeletedProviders(): string[] {
  try {
    const data = JSON.parse(fs.readFileSync(getDeletedProvidersPath(), "utf8")) as unknown;
    return Array.isArray(data) ? data.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export async function GET() {
  return NextResponse.json({ providers: readDeletedProviders() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null) as { providers?: unknown } | null;
    const providers = Array.isArray(body?.providers)
      ? body.providers.filter((entry): entry is string => typeof entry === "string")
      : [];
    writePrivateFileAtomicSync(getDeletedProvidersPath(), JSON.stringify(providers, null, 2));
    return NextResponse.json({ success: true, providers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
