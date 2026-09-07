import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  tsconfigPaths: true,
});
const { GET } = await jiti.import("./route.ts");

test("GET returns pi update status object with expected fields", async () => {
  const req = new Request("http://localhost/api/pi-update");
  const res = await GET(req);
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(typeof data.currentVersion, "string");
  assert.equal(typeof data.latestVersion, "string");
  assert.equal(typeof data.updateAvailable, "boolean");
});
