import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { CleanupHookConfig } from "../cleanup/types.ts";
import { DEFAULT_PATCHMILL_CONFIG } from "./defaults.ts";
import type { PatchmillConfig } from "./types.ts";

const CONFIG_FILE_NAME = "patchmill.config.json";

type Env = Record<string, string | undefined>;

type PartialPiTaskContract = Partial<PatchmillConfig["projectPolicy"]["pi"]["taskContract"]>;

type PartialPiWorkflowPolicy = Partial<Omit<PatchmillConfig["projectPolicy"]["pi"], "taskContract">> & {
  taskContract?: PartialPiTaskContract;
};

type PartialProjectPolicy = Partial<Omit<PatchmillConfig["projectPolicy"], "validation" | "directLand" | "visualEvidence" | "pi">> & {
  validation?: Partial<PatchmillConfig["projectPolicy"]["validation"]>;
  directLand?: Partial<PatchmillConfig["projectPolicy"]["directLand"]>;
  visualEvidence?: Partial<PatchmillConfig["projectPolicy"]["visualEvidence"]>;
  pi?: PartialPiWorkflowPolicy;
};

type PartialConfig = Partial<{
  host: Partial<PatchmillConfig["host"]>;
  pi: Partial<PatchmillConfig["pi"]>;
  paths: Partial<PatchmillConfig["paths"]>;
  labels: Partial<PatchmillConfig["labels"]>;
  git: Partial<PatchmillConfig["git"]>;
  cleanupHooks: CleanupHookConfig[];
  projectPolicy: PartialProjectPolicy;
}>;

function cloneStringArray(values: string[]): string[] {
  return [...values];
}

function cloneCleanupHooks(hooks: CleanupHookConfig[]): CleanupHookConfig[] {
  return hooks.map((hook) => ({
    name: hook.name,
    ...(hook.whenPathExists !== undefined ? { whenPathExists: hook.whenPathExists } : {}),
    ...(hook.terminateProcessPatterns !== undefined
      ? { terminateProcessPatterns: cloneStringArray(hook.terminateProcessPatterns) }
      : {}),
    ...(hook.command !== undefined ? { command: hook.command } : {}),
    ...(hook.args !== undefined ? { args: cloneStringArray(hook.args) } : {}),
  }));
}

function cloneValidationRules(
  rules: PatchmillConfig["projectPolicy"]["validation"]["rules"],
): PatchmillConfig["projectPolicy"]["validation"]["rules"] {
  return rules.map((rule) => ({
    category: rule.category,
    commands: cloneStringArray(rule.commands),
  }));
}

function cloneVisualEvidenceExample(
  example: NonNullable<PatchmillConfig["projectPolicy"]["visualEvidence"]["prEvidenceExample"]>,
): NonNullable<PatchmillConfig["projectPolicy"]["visualEvidence"]["prEvidenceExample"]> {
  return {
    screenshotPath: example.screenshotPath,
    ...(example.caption !== undefined ? { caption: example.caption } : {}),
    ...(example.referencePaths !== undefined ? { referencePaths: cloneStringArray(example.referencePaths) } : {}),
  };
}

function cloneVisualEvidencePolicy(
  visualEvidence: PatchmillConfig["projectPolicy"]["visualEvidence"],
): PatchmillConfig["projectPolicy"]["visualEvidence"] {
  return {
    policyText: visualEvidence.policyText,
    ...(visualEvidence.webScreenshotSkill !== undefined
      ? { webScreenshotSkill: visualEvidence.webScreenshotSkill }
      : {}),
    ...(visualEvidence.mobileScreenshotSkill !== undefined
      ? { mobileScreenshotSkill: visualEvidence.mobileScreenshotSkill }
      : {}),
    ...(visualEvidence.referenceScreenshotPaths !== undefined
      ? { referenceScreenshotPaths: cloneStringArray(visualEvidence.referenceScreenshotPaths) }
      : {}),
    ...(visualEvidence.reviewerExpectations !== undefined
      ? { reviewerExpectations: cloneStringArray(visualEvidence.reviewerExpectations) }
      : {}),
    ...(visualEvidence.prEvidenceExample !== undefined
      ? { prEvidenceExample: cloneVisualEvidenceExample(visualEvidence.prEvidenceExample) }
      : {}),
  };
}

function mergeVisualEvidencePolicy(
  base: PatchmillConfig["projectPolicy"]["visualEvidence"],
  update: PartialProjectPolicy["visualEvidence"] | undefined,
): PatchmillConfig["projectPolicy"]["visualEvidence"] {
  return {
    policyText: update?.policyText ?? base.policyText,
    ...(update?.webScreenshotSkill !== undefined
      ? { webScreenshotSkill: update.webScreenshotSkill }
      : base.webScreenshotSkill !== undefined
        ? { webScreenshotSkill: base.webScreenshotSkill }
        : {}),
    ...(update?.mobileScreenshotSkill !== undefined
      ? { mobileScreenshotSkill: update.mobileScreenshotSkill }
      : base.mobileScreenshotSkill !== undefined
        ? { mobileScreenshotSkill: base.mobileScreenshotSkill }
        : {}),
    ...(update?.referenceScreenshotPaths !== undefined
      ? { referenceScreenshotPaths: cloneStringArray(update.referenceScreenshotPaths) }
      : base.referenceScreenshotPaths !== undefined
        ? { referenceScreenshotPaths: cloneStringArray(base.referenceScreenshotPaths) }
        : {}),
    ...(update?.reviewerExpectations !== undefined
      ? { reviewerExpectations: cloneStringArray(update.reviewerExpectations) }
      : base.reviewerExpectations !== undefined
        ? { reviewerExpectations: cloneStringArray(base.reviewerExpectations) }
        : {}),
    ...(update?.prEvidenceExample !== undefined
      ? { prEvidenceExample: cloneVisualEvidenceExample(update.prEvidenceExample) }
      : base.prEvidenceExample !== undefined
        ? { prEvidenceExample: cloneVisualEvidenceExample(base.prEvidenceExample) }
        : {}),
  };
}

function clonePiTaskContract(
  taskContract: PatchmillConfig["projectPolicy"]["pi"]["taskContract"],
): PatchmillConfig["projectPolicy"]["pi"]["taskContract"] {
  return {
    todoRoot: taskContract.todoRoot,
    todoTitlePattern: taskContract.todoTitlePattern,
    todoTags: cloneStringArray(taskContract.todoTags),
    planTodoBodyRequirements: cloneStringArray(taskContract.planTodoBodyRequirements),
    implementationTodoBodyRequirements: cloneStringArray(taskContract.implementationTodoBodyRequirements),
    doneStatuses: cloneStringArray(taskContract.doneStatuses),
    planTaskHeadingPattern: taskContract.planTaskHeadingPattern,
    openTaskTodosBlockFinalHandoff: taskContract.openTaskTodosBlockFinalHandoff,
  };
}

function mergePiTaskContract(
  base: PatchmillConfig["projectPolicy"]["pi"]["taskContract"],
  update: PartialPiTaskContract | undefined,
): PatchmillConfig["projectPolicy"]["pi"]["taskContract"] {
  return {
    todoRoot: update?.todoRoot ?? base.todoRoot,
    todoTitlePattern: update?.todoTitlePattern ?? base.todoTitlePattern,
    todoTags: cloneStringArray(update?.todoTags ?? base.todoTags),
    planTodoBodyRequirements: cloneStringArray(
      update?.planTodoBodyRequirements ?? base.planTodoBodyRequirements,
    ),
    implementationTodoBodyRequirements: cloneStringArray(
      update?.implementationTodoBodyRequirements ?? base.implementationTodoBodyRequirements,
    ),
    doneStatuses: cloneStringArray(update?.doneStatuses ?? base.doneStatuses),
    planTaskHeadingPattern: update?.planTaskHeadingPattern ?? base.planTaskHeadingPattern,
    openTaskTodosBlockFinalHandoff:
      update?.openTaskTodosBlockFinalHandoff ?? base.openTaskTodosBlockFinalHandoff,
  };
}

function clonePiWorkflowPolicy(
  pi: PatchmillConfig["projectPolicy"]["pi"],
): PatchmillConfig["projectPolicy"]["pi"] {
  return {
    todoWorkflowInstruction: pi.todoWorkflowInstruction,
    subagentWorkflowInstruction: pi.subagentWorkflowInstruction,
    taskContract: clonePiTaskContract(pi.taskContract),
  };
}

function cloneProjectPolicy(projectPolicy: PatchmillConfig["projectPolicy"]): PatchmillConfig["projectPolicy"] {
  return {
    ...(projectPolicy.projectName !== undefined ? { projectName: projectPolicy.projectName } : {}),
    contextFileNames: cloneStringArray(projectPolicy.contextFileNames),
    toolchainInstruction: projectPolicy.toolchainInstruction,
    validation: {
      rules: cloneValidationRules(projectPolicy.validation.rules),
      forbiddenSubstitutions: cloneStringArray(projectPolicy.validation.forbiddenSubstitutions),
    },
    directLand: { ...projectPolicy.directLand },
    visualEvidence: cloneVisualEvidencePolicy(projectPolicy.visualEvidence),
    hostToolingInstruction: projectPolicy.hostToolingInstruction,
    pi: clonePiWorkflowPolicy(projectPolicy.pi),
    planRequiresApproval: projectPolicy.planRequiresApproval,
  };
}

function mergeProjectPolicy(
  base: PatchmillConfig["projectPolicy"],
  update: PartialProjectPolicy | undefined,
): PatchmillConfig["projectPolicy"] {
  return {
    ...(update?.projectName !== undefined ? { projectName: update.projectName } : base.projectName !== undefined ? { projectName: base.projectName } : {}),
    contextFileNames: cloneStringArray(update?.contextFileNames ?? base.contextFileNames),
    toolchainInstruction: update?.toolchainInstruction ?? base.toolchainInstruction,
    validation: {
      rules: cloneValidationRules(update?.validation?.rules ?? base.validation.rules),
      forbiddenSubstitutions: cloneStringArray(
        update?.validation?.forbiddenSubstitutions ?? base.validation.forbiddenSubstitutions,
      ),
    },
    directLand: { ...base.directLand, ...update?.directLand },
    visualEvidence: mergeVisualEvidencePolicy(base.visualEvidence, update?.visualEvidence),
    hostToolingInstruction: update?.hostToolingInstruction ?? base.hostToolingInstruction,
    pi: {
      todoWorkflowInstruction: update?.pi?.todoWorkflowInstruction ?? base.pi.todoWorkflowInstruction,
      subagentWorkflowInstruction:
        update?.pi?.subagentWorkflowInstruction ?? base.pi.subagentWorkflowInstruction,
      taskContract: mergePiTaskContract(base.pi.taskContract, update?.pi?.taskContract),
    },
    planRequiresApproval: update?.planRequiresApproval ?? base.planRequiresApproval,
  };
}

function mergeConfig(base: PatchmillConfig, update: PartialConfig): PatchmillConfig {
  const labels = { ...base.labels, ...update.labels };
  const paths = { ...base.paths, ...update.paths };

  return {
    host: { ...base.host, ...update.host },
    pi: { ...base.pi, ...update.pi },
    labels: {
      ...labels,
      priorities: cloneStringArray(update.labels?.priorities ?? base.labels.priorities),
    },
    paths: {
      ...paths,
      cleanStatusIgnorePrefixes: cloneStringArray(
        update.paths?.cleanStatusIgnorePrefixes ?? base.paths.cleanStatusIgnorePrefixes,
      ),
    },
    git: { ...base.git, ...update.git },
    cleanupHooks: cloneCleanupHooks(update.cleanupHooks ?? base.cleanupHooks),
    projectPolicy: mergeProjectPolicy(base.projectPolicy, update.projectPolicy),
  };
}

function absolutize(root: string, value: string): string {
  return isAbsolute(value) ? value : resolve(root, value);
}

function absolutizePaths(root: string, config: PatchmillConfig): PatchmillConfig {
  return {
    ...config,
    paths: {
      plansDir: absolutize(root, config.paths.plansDir),
      runStateDir: absolutize(root, config.paths.runStateDir),
      triageLogDir: absolutize(root, config.paths.triageLogDir),
      worktreeDir: absolutize(root, config.paths.worktreeDir),
      cleanStatusIgnorePrefixes: cloneStringArray(config.paths.cleanStatusIgnorePrefixes),
    },
    cleanupHooks: cloneCleanupHooks(config.cleanupHooks),
    projectPolicy: cloneProjectPolicy(config.projectPolicy),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return String(value);
}

function configError(path: string, expected: string, value: unknown): Error {
  return new Error(`Invalid ${CONFIG_FILE_NAME}: ${path} must be ${expected}; received ${describeValue(value)}`);
}

function readOptionalSection(source: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw configError(key, "an object", value);
  return value;
}

function readOptionalString(source: Record<string, unknown>, key: string, path: string): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw configError(path, "a string", value);
  return value;
}

function readOptionalBoolean(source: Record<string, unknown>, key: string, path: string): boolean | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw configError(path, "a boolean", value);
  return value;
}

function readOptionalPositiveInteger(source: Record<string, unknown>, key: string, path: string): number | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw configError(path, "a positive integer", value);
  }
  return value;
}

function readOptionalStringArray(source: Record<string, unknown>, key: string, path: string): string[] | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw configError(path, "an array of strings", value);
  }
  return cloneStringArray(value);
}

function readOptionalLiteral<T extends string>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly [T, ...T[]],
): T | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    const expected =
      allowed.length === 1
        ? `the literal ${JSON.stringify(allowed[0])}`
        : `one of ${allowed.map((entry) => JSON.stringify(entry)).join(", ")}`;
    throw configError(path, expected, value);
  }
  return value as T;
}

function readCleanupHooks(source: Record<string, unknown>): CleanupHookConfig[] | undefined {
  const value = source.cleanupHooks;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw configError("cleanupHooks", "an array of cleanup hook objects", value);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw configError(`cleanupHooks[${index}]`, "an object", entry);
    }

    const name = readOptionalString(entry, "name", `cleanupHooks[${index}].name`);
    if (name === undefined) {
      throw configError(`cleanupHooks[${index}].name`, "a string", entry.name);
    }

    return {
      name,
      whenPathExists: readOptionalString(entry, "whenPathExists", `cleanupHooks[${index}].whenPathExists`),
      terminateProcessPatterns: readOptionalStringArray(
        entry,
        "terminateProcessPatterns",
        `cleanupHooks[${index}].terminateProcessPatterns`,
      ),
      command: readOptionalString(entry, "command", `cleanupHooks[${index}].command`),
      args: readOptionalStringArray(entry, "args", `cleanupHooks[${index}].args`),
    };
  });
}

function readValidationRules(
  source: Record<string, unknown>,
  key: string,
  path: string,
): PatchmillConfig["projectPolicy"]["validation"]["rules"] | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw configError(path, "an array of validation rule objects", value);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw configError(`${path}[${index}]`, "an object", entry);
    }

    const category = readOptionalString(entry, "category", `${path}[${index}].category`);
    if (category === undefined) {
      throw configError(`${path}[${index}].category`, "a string", entry.category);
    }

    const commands = readOptionalStringArray(entry, "commands", `${path}[${index}].commands`);
    if (commands === undefined) {
      throw configError(`${path}[${index}].commands`, "an array of strings", entry.commands);
    }

    return { category, commands };
  });
}

function readOptionalVisualEvidenceExample(
  source: Record<string, unknown>,
  key: string,
  path: string,
): PatchmillConfig["projectPolicy"]["visualEvidence"]["prEvidenceExample"] | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw configError(path, "an object", value);

  const screenshotPath = readOptionalString(value, "screenshotPath", `${path}.screenshotPath`);
  if (screenshotPath === undefined) {
    throw configError(`${path}.screenshotPath`, "a string", value.screenshotPath);
  }

  const caption = readOptionalString(value, "caption", `${path}.caption`);
  const referencePaths = readOptionalStringArray(value, "referencePaths", `${path}.referencePaths`);

  return {
    screenshotPath,
    ...(caption !== undefined ? { caption } : {}),
    ...(referencePaths !== undefined ? { referencePaths } : {}),
  };
}

function hasEntries(value: object): boolean {
  return Object.keys(value).length > 0;
}

function parseConfigFile(data: unknown): PartialConfig {
  if (!isRecord(data)) {
    throw new Error(`Invalid ${CONFIG_FILE_NAME}: top-level value must be an object`);
  }

  const config: PartialConfig = {};

  const host = readOptionalSection(data, "host");
  if (host) {
    const parsed: Partial<PatchmillConfig["host"]> = {};
    const provider = readOptionalLiteral(host, "provider", "host.provider", ["forgejo-tea"]);
    const login = readOptionalString(host, "login", "host.login");
    if (provider !== undefined) parsed.provider = provider;
    if (login !== undefined) parsed.login = login;
    if (hasEntries(parsed)) config.host = parsed;
  }

  const pi = readOptionalSection(data, "pi");
  if (pi) {
    const parsed: Partial<PatchmillConfig["pi"]> = {};
    const team = readOptionalString(pi, "team", "pi.team");
    const triageThinking = readOptionalString(pi, "triageThinking", "pi.triageThinking");
    if (team !== undefined) parsed.team = team;
    if (triageThinking !== undefined) parsed.triageThinking = triageThinking;
    if (hasEntries(parsed)) config.pi = parsed;
  }

  const labels = readOptionalSection(data, "labels");
  if (labels) {
    const parsed: Partial<PatchmillConfig["labels"]> = {};
    const ready = readOptionalString(labels, "ready", "labels.ready");
    const needsInfo = readOptionalString(labels, "needsInfo", "labels.needsInfo");
    const unsuitable = readOptionalString(labels, "unsuitable", "labels.unsuitable");
    const inProgress = readOptionalString(labels, "inProgress", "labels.inProgress");
    const done = readOptionalString(labels, "done", "labels.done");
    const blocked = readOptionalString(labels, "blocked", "labels.blocked");
    const priorities = readOptionalStringArray(labels, "priorities", "labels.priorities");
    if (ready !== undefined) parsed.ready = ready;
    if (needsInfo !== undefined) parsed.needsInfo = needsInfo;
    if (unsuitable !== undefined) parsed.unsuitable = unsuitable;
    if (inProgress !== undefined) parsed.inProgress = inProgress;
    if (done !== undefined) parsed.done = done;
    if (blocked !== undefined) parsed.blocked = blocked;
    if (priorities !== undefined) parsed.priorities = priorities;
    if (hasEntries(parsed)) config.labels = parsed;
  }

  const paths = readOptionalSection(data, "paths");
  if (paths) {
    const parsed: Partial<PatchmillConfig["paths"]> = {};
    const plansDir = readOptionalString(paths, "plansDir", "paths.plansDir");
    const runStateDir = readOptionalString(paths, "runStateDir", "paths.runStateDir");
    const triageLogDir = readOptionalString(paths, "triageLogDir", "paths.triageLogDir");
    const worktreeDir = readOptionalString(paths, "worktreeDir", "paths.worktreeDir");
    const cleanStatusIgnorePrefixes = readOptionalStringArray(
      paths,
      "cleanStatusIgnorePrefixes",
      "paths.cleanStatusIgnorePrefixes",
    );
    if (plansDir !== undefined) parsed.plansDir = plansDir;
    if (runStateDir !== undefined) parsed.runStateDir = runStateDir;
    if (triageLogDir !== undefined) parsed.triageLogDir = triageLogDir;
    if (worktreeDir !== undefined) parsed.worktreeDir = worktreeDir;
    if (cleanStatusIgnorePrefixes !== undefined) parsed.cleanStatusIgnorePrefixes = cleanStatusIgnorePrefixes;
    if (hasEntries(parsed)) config.paths = parsed;
  }

  const git = readOptionalSection(data, "git");
  if (git) {
    const parsed: Partial<PatchmillConfig["git"]> = {};
    const baseBranch = readOptionalString(git, "baseBranch", "git.baseBranch");
    const baseRef = readOptionalString(git, "baseRef", "git.baseRef");
    const remote = readOptionalString(git, "remote", "git.remote");
    const branchPrefix = readOptionalString(git, "branchPrefix", "git.branchPrefix");
    const worktreePrefix = readOptionalString(git, "worktreePrefix", "git.worktreePrefix");
    const slugLength = readOptionalPositiveInteger(git, "slugLength", "git.slugLength");
    const allowDirectLand = readOptionalBoolean(git, "allowDirectLand", "git.allowDirectLand");
    if (baseBranch !== undefined) parsed.baseBranch = baseBranch;
    if (baseRef !== undefined) parsed.baseRef = baseRef;
    if (remote !== undefined) parsed.remote = remote;
    if (branchPrefix !== undefined) parsed.branchPrefix = branchPrefix;
    if (worktreePrefix !== undefined) parsed.worktreePrefix = worktreePrefix;
    if (slugLength !== undefined) parsed.slugLength = slugLength;
    if (allowDirectLand !== undefined) parsed.allowDirectLand = allowDirectLand;
    if (hasEntries(parsed)) config.git = parsed;
  }

  const cleanupHooks = readCleanupHooks(data);
  if (cleanupHooks !== undefined) {
    config.cleanupHooks = cleanupHooks;
  }

  const projectPolicy = readOptionalSection(data, "projectPolicy");
  if (projectPolicy) {
    const parsed: PartialProjectPolicy = {};
    const projectName = readOptionalString(projectPolicy, "projectName", "projectPolicy.projectName");
    const contextFileNames = readOptionalStringArray(
      projectPolicy,
      "contextFileNames",
      "projectPolicy.contextFileNames",
    );
    const toolchainInstruction = readOptionalString(
      projectPolicy,
      "toolchainInstruction",
      "projectPolicy.toolchainInstruction",
    );
    const validation = readOptionalSection(projectPolicy, "validation");
    if (validation) {
      const parsedValidation: NonNullable<PartialProjectPolicy["validation"]> = {};
      const rules = readValidationRules(validation, "rules", "projectPolicy.validation.rules");
      const forbiddenSubstitutions = readOptionalStringArray(
        validation,
        "forbiddenSubstitutions",
        "projectPolicy.validation.forbiddenSubstitutions",
      );
      if (rules !== undefined) parsedValidation.rules = rules;
      if (forbiddenSubstitutions !== undefined) parsedValidation.forbiddenSubstitutions = forbiddenSubstitutions;
      if (hasEntries(parsedValidation)) parsed.validation = parsedValidation;
    }
    const directLand = readOptionalSection(projectPolicy, "directLand");
    if (directLand) {
      const parsedDirectLand: NonNullable<PartialProjectPolicy["directLand"]> = {};
      const policyText = readOptionalString(directLand, "policyText", "projectPolicy.directLand.policyText");
      const targetBranch = readOptionalString(directLand, "targetBranch", "projectPolicy.directLand.targetBranch");
      if (policyText !== undefined) parsedDirectLand.policyText = policyText;
      if (targetBranch !== undefined) parsedDirectLand.targetBranch = targetBranch;
      if (hasEntries(parsedDirectLand)) parsed.directLand = parsedDirectLand;
    }
    const visualEvidence = readOptionalSection(projectPolicy, "visualEvidence");
    if (visualEvidence) {
      const parsedVisualEvidence: NonNullable<PartialProjectPolicy["visualEvidence"]> = {};
      const policyText = readOptionalString(
        visualEvidence,
        "policyText",
        "projectPolicy.visualEvidence.policyText",
      );
      const webScreenshotSkill = readOptionalString(
        visualEvidence,
        "webScreenshotSkill",
        "projectPolicy.visualEvidence.webScreenshotSkill",
      );
      const mobileScreenshotSkill = readOptionalString(
        visualEvidence,
        "mobileScreenshotSkill",
        "projectPolicy.visualEvidence.mobileScreenshotSkill",
      );
      const referenceScreenshotPaths = readOptionalStringArray(
        visualEvidence,
        "referenceScreenshotPaths",
        "projectPolicy.visualEvidence.referenceScreenshotPaths",
      );
      const reviewerExpectations = readOptionalStringArray(
        visualEvidence,
        "reviewerExpectations",
        "projectPolicy.visualEvidence.reviewerExpectations",
      );
      const prEvidenceExample = readOptionalVisualEvidenceExample(
        visualEvidence,
        "prEvidenceExample",
        "projectPolicy.visualEvidence.prEvidenceExample",
      );
      if (policyText !== undefined) parsedVisualEvidence.policyText = policyText;
      if (webScreenshotSkill !== undefined) parsedVisualEvidence.webScreenshotSkill = webScreenshotSkill;
      if (mobileScreenshotSkill !== undefined) parsedVisualEvidence.mobileScreenshotSkill = mobileScreenshotSkill;
      if (referenceScreenshotPaths !== undefined) parsedVisualEvidence.referenceScreenshotPaths = referenceScreenshotPaths;
      if (reviewerExpectations !== undefined) parsedVisualEvidence.reviewerExpectations = reviewerExpectations;
      if (prEvidenceExample !== undefined) parsedVisualEvidence.prEvidenceExample = prEvidenceExample;
      if (hasEntries(parsedVisualEvidence)) parsed.visualEvidence = parsedVisualEvidence;
    }
    const hostToolingInstruction = readOptionalString(
      projectPolicy,
      "hostToolingInstruction",
      "projectPolicy.hostToolingInstruction",
    );
    const piWorkflow = readOptionalSection(projectPolicy, "pi");
    if (piWorkflow) {
      const parsedPi: NonNullable<PartialProjectPolicy["pi"]> = {};
      const todoWorkflowInstruction = readOptionalString(
        piWorkflow,
        "todoWorkflowInstruction",
        "projectPolicy.pi.todoWorkflowInstruction",
      );
      const subagentWorkflowInstruction = readOptionalString(
        piWorkflow,
        "subagentWorkflowInstruction",
        "projectPolicy.pi.subagentWorkflowInstruction",
      );
      const taskContract = readOptionalSection(piWorkflow, "taskContract");
      if (todoWorkflowInstruction !== undefined) parsedPi.todoWorkflowInstruction = todoWorkflowInstruction;
      if (subagentWorkflowInstruction !== undefined) {
        parsedPi.subagentWorkflowInstruction = subagentWorkflowInstruction;
      }
      if (taskContract) {
        const parsedTaskContract: PartialPiTaskContract = {};
        const todoRoot = readOptionalString(taskContract, "todoRoot", "projectPolicy.pi.taskContract.todoRoot");
        const todoTitlePattern = readOptionalString(
          taskContract,
          "todoTitlePattern",
          "projectPolicy.pi.taskContract.todoTitlePattern",
        );
        const todoTags = readOptionalStringArray(
          taskContract,
          "todoTags",
          "projectPolicy.pi.taskContract.todoTags",
        );
        const planTodoBodyRequirements = readOptionalStringArray(
          taskContract,
          "planTodoBodyRequirements",
          "projectPolicy.pi.taskContract.planTodoBodyRequirements",
        );
        const implementationTodoBodyRequirements = readOptionalStringArray(
          taskContract,
          "implementationTodoBodyRequirements",
          "projectPolicy.pi.taskContract.implementationTodoBodyRequirements",
        );
        const doneStatuses = readOptionalStringArray(
          taskContract,
          "doneStatuses",
          "projectPolicy.pi.taskContract.doneStatuses",
        );
        const planTaskHeadingPattern = readOptionalString(
          taskContract,
          "planTaskHeadingPattern",
          "projectPolicy.pi.taskContract.planTaskHeadingPattern",
        );
        const openTaskTodosBlockFinalHandoff = readOptionalBoolean(
          taskContract,
          "openTaskTodosBlockFinalHandoff",
          "projectPolicy.pi.taskContract.openTaskTodosBlockFinalHandoff",
        );
        if (todoRoot !== undefined) parsedTaskContract.todoRoot = todoRoot;
        if (todoTitlePattern !== undefined) parsedTaskContract.todoTitlePattern = todoTitlePattern;
        if (todoTags !== undefined) parsedTaskContract.todoTags = todoTags;
        if (planTodoBodyRequirements !== undefined) {
          parsedTaskContract.planTodoBodyRequirements = planTodoBodyRequirements;
        }
        if (implementationTodoBodyRequirements !== undefined) {
          parsedTaskContract.implementationTodoBodyRequirements = implementationTodoBodyRequirements;
        }
        if (doneStatuses !== undefined) parsedTaskContract.doneStatuses = doneStatuses;
        if (planTaskHeadingPattern !== undefined) {
          parsedTaskContract.planTaskHeadingPattern = planTaskHeadingPattern;
        }
        if (openTaskTodosBlockFinalHandoff !== undefined) {
          parsedTaskContract.openTaskTodosBlockFinalHandoff = openTaskTodosBlockFinalHandoff;
        }
        if (hasEntries(parsedTaskContract)) parsedPi.taskContract = parsedTaskContract;
      }
      if (hasEntries(parsedPi)) parsed.pi = parsedPi;
    }
    const planRequiresApproval = readOptionalBoolean(
      projectPolicy,
      "planRequiresApproval",
      "projectPolicy.planRequiresApproval",
    );
    if (projectName !== undefined) parsed.projectName = projectName;
    if (contextFileNames !== undefined) parsed.contextFileNames = contextFileNames;
    if (toolchainInstruction !== undefined) parsed.toolchainInstruction = toolchainInstruction;
    if (hostToolingInstruction !== undefined) parsed.hostToolingInstruction = hostToolingInstruction;
    if (planRequiresApproval !== undefined) parsed.planRequiresApproval = planRequiresApproval;
    if (hasEntries(parsed)) config.projectPolicy = parsed;
  }

  return config;
}

type LoadedConfigFile = {
  config: PartialConfig;
  hasConfigFile: boolean;
};

async function readConfigFile(repoRoot: string): Promise<LoadedConfigFile> {
  let text: string;
  try {
    text = await readFile(join(repoRoot, CONFIG_FILE_NAME), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: {}, hasConfigFile: false };
    }
    throw error;
  }

  try {
    return {
      config: parseConfigFile(JSON.parse(text) as unknown),
      hasConfigFile: true,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid ${CONFIG_FILE_NAME}: ${error.message}`);
    }
    throw error;
  }
}

function envConfig(env: Env): PartialConfig {
  return {
    host: env.PATCHMILL_HOST_LOGIN ? { login: env.PATCHMILL_HOST_LOGIN } : {},
    pi: env.PATCHMILL_AGENT_TEAM ? { team: env.PATCHMILL_AGENT_TEAM } : {},
  };
}

function cliConfig(args: string[]): PartialConfig {
  const config: PartialConfig = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--host-login" || args[index] === "--tea-login") {
      const flag = args[index]!;
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      config.host = { ...(config.host ?? {}), login: value };
      index += 1;
    } else if (args[index] === "--agent-team") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--agent-team requires a value");
      config.pi = { ...(config.pi ?? {}), team: value };
      index += 1;
    }
  }
  return config;
}

export async function loadPatchmillConfigState(
  repoRoot: string,
  env: Env = process.env,
  args: string[] = [],
): Promise<{ config: PatchmillConfig; hasConfigFile: boolean }> {
  const { config: fromFile, hasConfigFile } = await readConfigFile(repoRoot);
  const merged = mergeConfig(mergeConfig(mergeConfig(DEFAULT_PATCHMILL_CONFIG, fromFile), envConfig(env)), cliConfig(args));
  return {
    config: absolutizePaths(repoRoot, merged),
    hasConfigFile,
  };
}

export async function loadPatchmillConfig(repoRoot: string, env: Env = process.env, args: string[] = []): Promise<PatchmillConfig> {
  return (await loadPatchmillConfigState(repoRoot, env, args)).config;
}
