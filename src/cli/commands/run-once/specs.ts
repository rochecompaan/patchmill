import {
  buildArtifactFilename,
  buildArtifactPath,
  findIssueArtifact,
} from "./artifacts.ts";

const SPEC_SUFFIX = "-design";

export function buildSpecFilename(
  issueNumber: number,
  title: string,
  date: string | Date,
): string {
  return buildArtifactFilename(issueNumber, title, date, {
    suffix: SPEC_SUFFIX,
  });
}

export function buildSpecPath(
  specsDir: string,
  issueNumber: number,
  title: string,
  date: string | Date,
): string {
  return buildArtifactPath(specsDir, issueNumber, title, date, {
    suffix: SPEC_SUFFIX,
  });
}

export async function findIssueSpec(
  specsDir: string,
  issueNumber: number,
): Promise<string | undefined> {
  return findIssueArtifact(specsDir, issueNumber);
}
