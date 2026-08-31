import {
  getEnvironmentMap,
  getProject,
  getProjectRepoStatuses,
  listEnvironments,
  listProjectBranches,
  previewSwitchEnvironment,
} from "./api";
import type {
  BranchInfo,
  Environment,
  EnvironmentBranch,
  ProjectDetail,
  RepoStatus,
  SwitchOptions,
  SwitchPreviewItem,
} from "./types";

export interface WorkspaceSnapshot {
  detail: ProjectDetail;
  environments: Environment[];
  statuses: Record<string, RepoStatus>;
  branches: Record<string, BranchInfo[]>;
}

interface WorkspaceEntry {
  snapshot?: WorkspaceSnapshot;
  promise?: Promise<WorkspaceSnapshot>;
}

const workspaceEntries = new Map<string, WorkspaceEntry>();
const environmentMaps = new Map<string, Record<string, string>>();
const environmentMapPromises = new Map<
  string,
  Promise<Record<string, string>>
>();
const switchPreviews = new Map<string, Record<string, SwitchPreviewItem>>();
const switchPreviewPromises = new Map<
  string,
  Promise<Record<string, SwitchPreviewItem>>
>();

const DEFAULT_SWITCH_OPTIONS: SwitchOptions = {
  stashIfDirty: false,
  fetchFirst: false,
  popStashAfter: false,
};

function statusRecord(items: RepoStatus[]): Record<string, RepoStatus> {
  const result: Record<string, RepoStatus> = {};
  for (const item of items) result[item.repoId] = item;
  return result;
}

function environmentRecord(items: EnvironmentBranch[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const item of items) result[item.repoId] = item.branch;
  return result;
}

function previewRecord(
  items: SwitchPreviewItem[],
): Record<string, SwitchPreviewItem> {
  const result: Record<string, SwitchPreviewItem> = {};
  for (const item of items) result[item.repoId] = item;
  return result;
}

function previewKey(
  projectId: string,
  environmentId: string,
  options: SwitchOptions,
): string {
  return [
    projectId,
    environmentId,
    Number(options.stashIfDirty),
    Number(options.fetchFirst),
    Number(options.popStashAfter),
  ].join(":");
}

function invalidateProjectPreviews(projectId: string): void {
  for (const key of switchPreviews.keys()) {
    if (key.startsWith(`${projectId}:`)) switchPreviews.delete(key);
  }
}

function invalidateEnvironmentPreviews(environmentId: string): void {
  for (const key of switchPreviews.keys()) {
    if (key.split(":")[1] === environmentId) switchPreviews.delete(key);
  }
}

export function peekWorkspace(projectId: string): WorkspaceSnapshot | null {
  return workspaceEntries.get(projectId)?.snapshot ?? null;
}

export function cacheWorkspaceRepoStatus(
  projectId: string,
  status: RepoStatus,
): void {
  const entry = workspaceEntries.get(projectId);
  if (!entry?.snapshot) return;
  entry.snapshot = {
    ...entry.snapshot,
    statuses: {
      ...entry.snapshot.statuses,
      [status.repoId]: status,
    },
  };
  invalidateProjectPreviews(projectId);
}

export function cacheWorkspaceRepoBranches(
  projectId: string,
  repoId: string,
  branches: BranchInfo[],
): void {
  const entry = workspaceEntries.get(projectId);
  if (!entry?.snapshot) return;
  entry.snapshot = {
    ...entry.snapshot,
    branches: {
      ...entry.snapshot.branches,
      [repoId]: branches,
    },
  };
}

export async function loadEnvironmentBranchMap(
  environmentId: string,
  force = false,
): Promise<Record<string, string>> {
  if (!force) {
    const cached = environmentMaps.get(environmentId);
    if (cached) return cached;
  }

  const pending = environmentMapPromises.get(environmentId);
  if (pending) return pending;

  if (force) invalidateEnvironmentPreviews(environmentId);
  const promise = getEnvironmentMap(environmentId)
    .then((items) => {
      const result = environmentRecord(items);
      environmentMaps.set(environmentId, result);
      return result;
    })
    .finally(() => {
      environmentMapPromises.delete(environmentId);
    });
  environmentMapPromises.set(environmentId, promise);
  return promise;
}

export function peekEnvironmentBranchMap(
  environmentId: string | null,
): Record<string, string> | null {
  return environmentId ? (environmentMaps.get(environmentId) ?? null) : null;
}

export function cacheEnvironmentBranch(
  environmentId: string,
  repoId: string,
  branch: string,
): void {
  const current = environmentMaps.get(environmentId) ?? {};
  environmentMaps.set(environmentId, { ...current, [repoId]: branch });
  invalidateEnvironmentPreviews(environmentId);
}

export function peekSwitchPreview(
  projectId: string,
  environmentId: string | null,
  options: SwitchOptions,
): Record<string, SwitchPreviewItem> | null {
  if (!environmentId) return null;
  return (
    switchPreviews.get(previewKey(projectId, environmentId, options)) ?? null
  );
}

export async function loadSwitchPreview(
  projectId: string,
  environmentId: string,
  options: SwitchOptions,
  force = false,
): Promise<Record<string, SwitchPreviewItem>> {
  const key = previewKey(projectId, environmentId, options);
  if (!force) {
    const cached = switchPreviews.get(key);
    if (cached) return cached;
  }

  const pending = switchPreviewPromises.get(key);
  if (pending) return pending;

  const promise = previewSwitchEnvironment(projectId, environmentId, options)
    .then((items) => {
      const result = previewRecord(items);
      switchPreviews.set(key, result);
      return result;
    })
    .finally(() => {
      switchPreviewPromises.delete(key);
    });
  switchPreviewPromises.set(key, promise);
  return promise;
}

async function prewarmWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
  const defaultEnvironment =
    snapshot.environments.find((environment) => environment.isDefault) ??
    snapshot.environments[0];
  const requests: Promise<unknown>[] = snapshot.environments.map(
    (environment) => loadEnvironmentBranchMap(environment.id),
  );
  if (defaultEnvironment) {
    requests.push(
      loadSwitchPreview(
        snapshot.detail.project.id,
        defaultEnvironment.id,
        DEFAULT_SWITCH_OPTIONS,
      ),
    );
  }
  await Promise.allSettled(requests);
}

export async function loadWorkspace(
  projectId: string,
  force = false,
): Promise<WorkspaceSnapshot> {
  const entry = workspaceEntries.get(projectId) ?? {};
  workspaceEntries.set(projectId, entry);

  if (!force && entry.snapshot) return entry.snapshot;
  if (entry.promise) return entry.promise;
  if (force) invalidateProjectPreviews(projectId);

  const promise = (async () => {
    const [detail, environments, statuses, branches] = await Promise.all([
      getProject(projectId),
      listEnvironments(projectId),
      getProjectRepoStatuses(projectId),
      listProjectBranches(projectId),
    ]);
    const snapshot: WorkspaceSnapshot = {
      detail,
      environments,
      statuses: statusRecord(statuses),
      branches,
    };

    // Complete these inexpensive dependent reads before route navigation can
    // expose a second loading screen.
    await prewarmWorkspace(snapshot);
    entry.snapshot = snapshot;
    return snapshot;
  })().finally(() => {
    entry.promise = undefined;
  });

  entry.promise = promise;
  return promise;
}
