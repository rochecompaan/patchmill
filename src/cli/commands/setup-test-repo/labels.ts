import type { LabelDefinition } from "../../../host/types.ts";

export const SETUP_TEST_REPO_LABELS: LabelDefinition[] = [
  {
    name: "feature",
    color: "0e8a16",
    description: "New user-facing functionality.",
  },
  {
    name: "bug",
    color: "d73a4a",
    description: "Something is broken or behaves incorrectly.",
  },
  {
    name: "docs",
    color: "0075ca",
    description: "Documentation or usage guidance.",
  },
  {
    name: "polish",
    color: "a2eeef",
    description: "Visual, UX, or cleanup improvement.",
  },
];
