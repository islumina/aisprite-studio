#!/usr/bin/env node
// Prints every missing frame's generation task for an asset, for hosts without MCP.
// Usage: npm run plan -- assets/<asset>
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getPendingTasks } from "./workspace.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function main(argument: string | undefined): Promise<number> {
  if (!argument) {
    console.error("Usage: npm run plan -- assets/<asset>");
    return 2;
  }
  const asset = path.basename(path.resolve(argument));
  const tasks = await getPendingTasks(ROOT, asset);
  if (tasks.length === 0) {
    console.log(`All frames declared in assets/${asset}/request.yml exist.`);
    return 0;
  }
  console.log(`${tasks.length} pending frame(s) for ${asset}. Generate each with its references, then submit through MCP.`);
  for (const task of tasks) {
    console.log(`\n[${task.frame.name}]`);
    console.log(`References: ${task.reference_paths.map((reference) => path.relative(ROOT, reference)).join(", ")}`);
    console.log(task.prompt);
  }
  return 0;
}

main(process.argv[2]).then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
