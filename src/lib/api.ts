import { invoke } from "@tauri-apps/api/core";
import type {
  ChangedFile,
  CommitLogEntry,
  CommitResult,
  CreateProjectRequest,
  Environment,
  EnvironmentBranch,
  ProjectDetail,
  ProjectSummary,
  PullResult,
  Repo,
  RepoStatus,
  ScannedRepo,
  SwitchOptions,
  SwitchPreviewItem,
  SwitchResult,
} from "./types";

export async function listProjects(): Promise<ProjectSummary[]> {
  return invoke("list_projects");
}

export async function getProject(id: string): Promise<ProjectDetail> {
  return invoke("get_project", { id });
}

export async function createProject(
  request: CreateProjectRequest,
): Promise<ProjectDetail> {
  return invoke("create_project", { request });
}

export async function deleteProject(id: string): Promise<void> {
  return invoke("delete_project", { id });
}

export async function scanRepos(
  rootPath: string,
  maxDepth?: number,
): Promise<ScannedRepo[]> {
  return invoke("scan_repos", { rootPath, maxDepth });
}

export async function addRepo(projectId: string, path: string): Promise<Repo> {
  return invoke("add_repo", { projectId, path });
}

export async function removeRepo(repoId: string): Promise<void> {
  return invoke("remove_repo", { repoId });
}

export async function setRepoEnabled(
  repoId: string,
  enabled: boolean,
): Promise<void> {
  return invoke("set_repo_enabled", { repoId, enabled });
}

export async function listEnvironments(
  projectId: string,
): Promise<Environment[]> {
  return invoke("list_environments", { projectId });
}

export async function createEnvironment(
  projectId: string,
  name: string,
  isDefault?: boolean,
): Promise<Environment> {
  return invoke("create_environment", { projectId, name, isDefault });
}

export async function updateEnvironment(
  envId: string,
  name?: string,
  isDefault?: boolean,
): Promise<Environment> {
  return invoke("update_environment", { envId, name, isDefault });
}

export async function deleteEnvironment(envId: string): Promise<void> {
  return invoke("delete_environment", { envId });
}

export async function getEnvironmentMap(
  envId: string,
): Promise<EnvironmentBranch[]> {
  return invoke("get_environment_map", { envId });
}

export async function setEnvironmentBranch(
  envId: string,
  repoId: string,
  branch: string,
): Promise<void> {
  return invoke("set_environment_branch", { envId, repoId, branch });
}

export async function getProjectRepoStatuses(
  projectId: string,
): Promise<RepoStatus[]> {
  return invoke("get_project_repo_statuses", { projectId });
}

export async function listBranches(repoId: string): Promise<string[]> {
  return invoke("list_branches", { repoId });
}

export async function listProjectBranches(
  projectId: string,
): Promise<Record<string, string[]>> {
  return invoke("list_project_branches", { projectId });
}

export async function checkoutBranch(
  repoId: string,
  branch: string,
  stashIfDirty = false,
): Promise<RepoStatus> {
  return invoke("checkout_branch", { repoId, branch, stashIfDirty });
}

export async function switchEnvironment(
  projectId: string,
  envId: string,
  options: SwitchOptions,
): Promise<SwitchResult[]> {
  return invoke("switch_environment", { projectId, envId, options });
}

export async function previewSwitchEnvironment(
  projectId: string,
  envId: string,
  options: SwitchOptions,
): Promise<SwitchPreviewItem[]> {
  return invoke("preview_switch_environment", { projectId, envId, options });
}

export async function pullAll(projectId: string): Promise<PullResult[]> {
  return invoke("pull_all", { projectId });
}

export async function fetchAllRepos(projectId: string): Promise<PullResult[]> {
  return invoke("fetch_all_repos", { projectId });
}

export async function pushAll(projectId: string): Promise<PullResult[]> {
  return invoke("push_all", { projectId });
}

export async function pullRepo(repoId: string): Promise<PullResult> {
  return invoke("pull_repo", { repoId });
}

export async function pushRepo(repoId: string): Promise<PullResult> {
  return invoke("push_repo", { repoId });
}

export async function fetchRepo(repoId: string): Promise<PullResult> {
  return invoke("fetch_repo", { repoId });
}

export async function getChangeSummary(repoId: string): Promise<string> {
  return invoke("get_change_summary", { repoId });
}

export async function listChangedFiles(repoId: string): Promise<ChangedFile[]> {
  return invoke("list_changed_files", { repoId });
}

/** Stage paths. Empty paths = stage all. Returns refreshed file list. */
export async function stageFiles(
  repoId: string,
  paths: string[],
): Promise<ChangedFile[]> {
  return invoke("stage_files", { repoId, paths });
}

/** Unstage paths. Empty paths = unstage all. Returns refreshed file list. */
export async function unstageFiles(
  repoId: string,
  paths: string[],
): Promise<ChangedFile[]> {
  return invoke("unstage_files", { repoId, paths });
}

export async function commitRepo(
  repoId: string,
  message: string,
  options: { stageAll?: boolean; paths?: string[] } = {},
): Promise<CommitResult> {
  const stageAll = options.stageAll ?? false;
  return invoke("commit_repo", {
    request: {
      repoId,
      message,
      stageAll,
      paths: options.paths ?? null,
    },
  });
}

export async function getCommitLog(
  repoId: string,
  limit = 40,
): Promise<CommitLogEntry[]> {
  return invoke("get_commit_log", { repoId, limit });
}

export async function getRepoPath(repoId: string): Promise<string> {
  return invoke("get_repo_path", { repoId });
}

export async function openRepoFolder(repoId: string): Promise<void> {
  const path = await getRepoPath(repoId);
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(path);
}

export async function createBranch(
  repoId: string,
  name: string,
  checkout = true,
): Promise<RepoStatus> {
  return invoke("create_branch", { repoId, name, checkout });
}

export async function deleteBranch(
  repoId: string,
  name: string,
  force = false,
): Promise<void> {
  return invoke("delete_branch", { repoId, name, force });
}

export async function checkoutCommit(
  repoId: string,
  rev: string,
  newBranch?: string | null,
): Promise<RepoStatus> {
  return invoke("checkout_commit", {
    repoId,
    rev,
    newBranch: newBranch ?? null,
  });
}

export async function getFileDiff(
  repoId: string,
  filePath: string,
): Promise<string> {
  return invoke("get_file_diff", { repoId, filePath });
}

export async function getSetting(key: string): Promise<string | null> {
  return invoke("get_setting", { key });
}

export async function pickFolder(
  title = "Select folder",
): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });
  if (selected === null) return null;
  if (Array.isArray(selected)) return selected[0] ?? null;
  return selected;
}
