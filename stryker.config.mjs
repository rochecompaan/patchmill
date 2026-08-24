/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
const config = {
  mutate: ["src/policy/todo-statuses.ts"],
  testRunner: "command",
  commandRunner: {
    command: "npm run test:mutation",
  },
  coverageAnalysis: "off",
  concurrency: 4,
  incremental: true,
  incrementalFile: "reports/mutation/incremental.json",
  reporters: ["clear-text", "progress", "html", "json"],
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
};

export default config;
