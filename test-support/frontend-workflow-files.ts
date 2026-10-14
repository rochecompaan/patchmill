import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const frontendWorkflowFiles = {
  "frontend-design/SKILL.md":
    "---\nname: frontend-design\ndescription: Design frontend work.\n---\n",
  "frontend-design/LICENSE.txt": "Apache-2.0\n",
  "patchmill-frontend-review/SKILL.md":
    "---\nname: patchmill-frontend-review\ndescription: Review frontend work.\n---\n",
  "patchmill-frontend-review/LICENSE": "MIT\n",
  "patchmill-frontend-review/references/upstream-web-design-guidelines.md":
    "upstream wrapper\n",
  "patchmill-frontend-review/references/web-interface-guidelines.md":
    "pinned rules\n",
};

export async function writeFrontendWorkflowFiles(
  root: string,
  skillDir = "",
  omit?: string,
) {
  for (const [path, body] of Object.entries(frontendWorkflowFiles)) {
    if (path === omit) continue;
    const target = join(root, skillDir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
  }
}
