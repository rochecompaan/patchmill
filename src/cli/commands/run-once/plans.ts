import {
  buildArtifactFilename,
  buildArtifactPath,
  findIssueArtifact,
} from "./artifacts.ts";

export function buildPlanFilename(
  issueNumber: number,
  title: string,
  date: string | Date,
): string {
  return buildArtifactFilename(issueNumber, title, date);
}

export function buildPlanPath(
  plansDir: string,
  issueNumber: number,
  title: string,
  date: string | Date,
): string {
  return buildArtifactPath(plansDir, issueNumber, title, date);
}

export async function findIssuePlan(
  plansDir: string,
  issueNumber: number,
): Promise<string | undefined> {
  return findIssueArtifact(plansDir, issueNumber);
}
