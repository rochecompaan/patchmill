/** @type {import("dependency-cruiser").IConfiguration} */
const config = {
  forbidden: [
    {
      name: "no-circular-dependencies",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "policy-does-not-depend-on-outer-layers",
      severity: "error",
      from: { path: "^src/policy" },
      to: { path: "^src/(cli|host|pi)" },
    },
    {
      name: "git-does-not-depend-on-outer-layers",
      severity: "error",
      from: { path: "^src/git" },
      to: { path: "^src/(cli|host|pi)" },
    },
    {
      name: "config-does-not-depend-on-runtime-layers",
      severity: "error",
      from: { path: "^src/config" },
      to: { path: "^src/(cli|host|pi)" },
    },
    {
      name: "workflow-does-not-depend-on-cli",
      severity: "error",
      from: { path: "^src/workflow" },
      to: { path: "^src/cli" },
    },
    {
      name: "no-unresolvable-dependencies",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsConfig: {
      fileName: "tsconfig.build.json",
    },
  },
};

export default config;
