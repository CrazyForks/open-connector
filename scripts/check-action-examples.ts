import type { ProviderDefinition } from "../src/core/types.ts";

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { validateActionInput } from "../src/core/validation.ts";
import { buildExampleInput } from "../src/server/api/action-example.ts";

// Run after generate:catalog. Read one provider at a time and skip Markdown rendering.
const directory = join(process.cwd(), "catalog/apps");
const started = performance.now();
let actions = 0;
let failures = 0;
let generationMs = 0;
for (const file of await readdir(directory)) {
  if (!file.endsWith(".json")) {
    continue;
  }
  const provider: ProviderDefinition = JSON.parse(await readFile(join(directory, file), "utf8"));
  for (const action of provider.actions) {
    actions += 1;
    try {
      const start = performance.now();
      const input = buildExampleInput(action.inputSchema);
      generationMs += performance.now() - start;
      const result = validateActionInput(action, input);
      if (!result.valid) {
        failures += 1;
        console.error(action.id, JSON.stringify({ input, errors: result.errors }));
      }
    } catch (error) {
      failures += 1;
      console.error(action.id, error);
    }
  }
}
console.log(
  JSON.stringify({
    actions,
    failures,
    elapsedMs: Math.round(performance.now() - started),
    generationMs: Math.round(generationMs),
    peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
  }),
);
process.exitCode = failures > 0 ? 1 : 0;
