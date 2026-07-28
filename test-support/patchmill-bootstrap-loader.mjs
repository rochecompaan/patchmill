const cliFixtureUrl = new URL("./patchmill-bootstrap-main.mjs", import.meta.url)
  .href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "../src/cli/main.ts") {
    return { url: cliFixtureUrl, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
