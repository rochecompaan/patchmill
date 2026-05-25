import {
  ForgejoVisualEvidenceUploader,
  hasForgejoVisualEvidenceConfig,
} from "../../../host/forgejo-visual-evidence.ts";
import type { ForgejoVisualEvidenceEnv } from "../../../host/forgejo-visual-evidence.ts";
import type { VisualEvidenceUploader } from "../../../host/visual-evidence.ts";
import type { AgentIssueVisualEvidence, CommandRunner } from "./types.ts";

export type UploadPrVisualEvidenceInput = {
  repoRoot: string;
  prUrl: string;
  evidence: AgentIssueVisualEvidence[] | undefined;
  uploader?: VisualEvidenceUploader;
  onProgress?: (message: string) => void | Promise<void>;
};

export type DefaultVisualEvidenceUploaderInput = {
  runner: CommandRunner;
  env?: ForgejoVisualEvidenceEnv;
  fetchImpl?: typeof fetch;
};

export function defaultVisualEvidenceUploader(
  input: DefaultVisualEvidenceUploaderInput,
): VisualEvidenceUploader | undefined {
  const env = input.env ?? process.env;
  if (!hasForgejoVisualEvidenceConfig(env)) return undefined;
  return new ForgejoVisualEvidenceUploader({
    runner: input.runner,
    env,
    fetchImpl: input.fetchImpl,
  });
}

export async function uploadPrVisualEvidence(
  input: UploadPrVisualEvidenceInput,
): Promise<AgentIssueVisualEvidence[]> {
  const evidence = input.evidence ?? [];
  if (evidence.length === 0) return [];
  if (!input.uploader) {
    await input.onProgress?.(
      "visual evidence present but no uploader configured; skipping host asset upload",
    );
    return evidence;
  }
  return input.uploader.uploadPrEvidence({
    repoRoot: input.repoRoot,
    prUrl: input.prUrl,
    evidence,
  });
}
