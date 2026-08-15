import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const OMW_PORT = 30142;

// Restarts the oh-my-web server process itself. Used after deleting a provider
// so the runtime really drops it (env vars are unset by the restart script).
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const home = homedir();
  const repo = join(home, ".project", "oh-my-web");
  const script = [
    "#!/bin/bash",
    `sleep 1`,
    `PID=$(ss -tlnp 2>/dev/null | grep ':${OMW_PORT}' | grep -oP 'pid=\\K[0-9]+' | head -1)`,
    `[ -n "$PID" ] && kill "$PID"`,
    `sleep 1`,
    `cd "${repo}"`,
    `PI_CODING_AGENT_DIR="${home}/.pi/oh-my-web-agent" nohup bash bin/start-oh-my-web.sh start > /tmp/omw-main.log 2>&1 &`,
  ].join("\n");

  const child = spawn("bash", ["-c", script], { detached: true, stdio: "ignore" });
  child.unref();
  return NextResponse.json({ success: true, restarted: true });
}
