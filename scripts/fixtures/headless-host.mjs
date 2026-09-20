import { createConnectorRuntime, getConnectorAssetDirectory } from "@oomol-lab/open-connector";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const expected = JSON.parse(process.argv[2]);
const files = await readdir(join(getConnectorAssetDirectory(), "catalog/apps"));
assert.deepEqual(files.filter((name) => name.endsWith(".json")).sort(), expected.map((id) => `${id}.json`).sort());

const runtime = await createConnectorRuntime({ dataDir: "./data", publicOrigin: "https://host.example" });
try {
  const response = await runtime.fetch(new Request("https://host.example/v1/providers"));
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.deepEqual(catalog.data.map((provider) => provider.service).sort(), expected);
} finally {
  await runtime.close();
}
