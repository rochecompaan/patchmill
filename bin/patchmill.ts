#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

function isMainModule(metaUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) return false;

  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url)) {
  delete process.env.PI_PACKAGE_DIR;
  const { main } = await import("../src/cli/main.ts");
  process.exitCode = await main();
}
