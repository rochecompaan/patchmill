export type IssueCommentSummary = {
  body: string;
  authorLogin?: string;
  created?: string;
};

export type IssueSummary = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  url?: string;
  author?: string;
  created?: string;
  updated?: string;
  comments?: IssueCommentSummary[];
};

export type LabelDefinition = {
  name: string;
  color: string;
  description: string;
};

export type LabelChangePlan = {
  issueNumber: number;
  oldLabels: string[];
  newLabels: string[];
  addLabels: string[];
  removeLabels: string[];
};
