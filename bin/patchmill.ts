#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { main } from "../src/cli/main.ts";

function isMainModule(metaUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) return false;

  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main();
}
