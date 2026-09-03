export type SetupIssue = {
  fileName: string;
  title: string;
  labels: string[];
  body: string;
};

function frontmatterValue(
  fields: Map<string, string>,
  name: string,
): string | undefined {
  const value = fields.get(name);
  return value === undefined ? undefined : value.trim();
}

function parseLabels(fileName: string, value: string | undefined): string[] {
  if (value === undefined) return [];
  const match = /^\[(.*)\]$/u.exec(value.trim());
  const rawLabels = match?.[1];
  if (rawLabels === undefined) {
    throw new Error(`${fileName} labels must use [label, other-label] syntax`);
  }

  if (rawLabels.trim().length === 0) return [];
  const labels = rawLabels.split(",").map((label) => label.trim());
  if (labels.some((label) => label.length === 0)) {
    throw new Error(`${fileName} labels include an empty value`);
  }
  return labels;
}

function parseFrontmatter(fileName: string, raw: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of raw.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/u.exec(line);
    const key = match?.[1];
    const value = match?.[2];
    if (key === undefined || value === undefined) {
      throw new Error(`${fileName} has invalid frontmatter: ${line}`);
    }
    fields.set(key, value);
  }
  return fields;
}

export function parseIssueFile(fileName: string, content: string): SetupIssue {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(content);
  const frontmatter = match?.[1];
  const rawBody = match?.[2];
  if (frontmatter === undefined || rawBody === undefined) {
    throw new Error(`${fileName} is missing frontmatter`);
  }

  const fields = parseFrontmatter(fileName, frontmatter);
  const title = frontmatterValue(fields, "title");
  if (!title) {
    throw new Error(`${fileName} is missing required frontmatter field: title`);
  }

  return {
    fileName,
    title,
    labels: parseLabels(fileName, frontmatterValue(fields, "labels")),
    body: rawBody.replace(/^\r?\n/u, "").replace(/\s*$/u, "") + "\n",
  };
}
