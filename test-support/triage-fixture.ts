import fs from "node:fs/promises";
import { join } from "node:path";

export async function createTriagePi(root: string, outputs: string[]) {
  const script = join(root, "pi.mjs");
  // Local child exercises the actual supervisor and records its launch boundary.
  await fs.writeFile(
    script,
    `import fs from 'node:fs';\nconst root=${JSON.stringify(root)};\nfs.appendFileSync(root+'/launches', JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),agentDir:process.env.PI_CODING_AGENT_DIR})+'\\n');\nconst outputs=${JSON.stringify(outputs)};\nconst count=fs.readFileSync(root+'/launches','utf8').trim().split('\\n').length;\nconsole.log(outputs[count-1]);`,
  );
  return { command: process.execPath, argsPrefix: [script] };
}
