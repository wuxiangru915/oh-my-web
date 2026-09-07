import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  parseVersionParts,
  isNewerVersion,
  getInstalledPiVersion,
} = await jiti.import("./pi-update.ts");

test("parses standard and prefixed semver strings", () => {
  assert.deepEqual(parseVersionParts("0.84.1"), [0, 84, 1]);
  assert.deepEqual(parseVersionParts("v0.85.1"), [0, 85, 1]);
  assert.deepEqual(parseVersionParts(" 1.2.3 "), [1, 2, 3]);
  assert.equal(parseVersionParts("invalid"), null);
  assert.equal(parseVersionParts(""), null);
});

test("correctly detects newer versions", () => {
  assert.equal(isNewerVersion("0.85.1", "0.84.1"), true);
  assert.equal(isNewerVersion("0.85.0", "0.84.1"), true);
  assert.equal(isNewerVersion("0.84.2", "0.84.1"), true);
  assert.equal(isNewerVersion("1.0.0", "0.85.1"), true);
  assert.equal(isNewerVersion("v0.85.1", "0.84.1"), true);

  assert.equal(isNewerVersion("0.84.1", "0.84.1"), false);
  assert.equal(isNewerVersion("0.84.0", "0.84.1"), false);
  assert.equal(isNewerVersion("0.83.9", "0.84.1"), false);
  assert.equal(isNewerVersion("invalid", "0.84.1"), false);
  assert.equal(isNewerVersion("0.85.1", "invalid"), false);
});

test("gets installed pi version from node_modules or package.json", () => {
  const version = getInstalledPiVersion();
  assert.equal(typeof version, "string");
  assert.match(version, /^\d+\.\d+\.\d+/);
});
