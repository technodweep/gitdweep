export interface Project {
  id: string;
  name: string;
  rootPath: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  rootPath: string | null;
  repoCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface Repo {
  id: string;
  projectId: string;
  path: string;
  name: string;
  enabled: boolean;
  createdAt: number;
}

export interface ProjectDetail {
  project: Project;
  repos: Repo[];
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
}

export interface EnvironmentBranch {
  environmentId: string;
  repoId: string;
  branch: string;
}

export interface ScannedRepo {
  path: string;
  name: string;
}

export interface CreateProjectRequest {
  name: string;
  rootPath?: string | null;
  repoPaths: string[];
}

export interface RepoStatus {
  repoId: string;
  path: string;
  currentBranch: string | null;
  isDetached: boolean;
  isDirty: boolean;
  ahead: number | null;
  behind: number | null;
  lastCommit: string | null;
  lastCommitAt: string | null;
  isMerging?: boolean;
  isRebasing?: boolean;
  conflictFiles?: string[];
  error: string | null;
}

export interface MergeResult {
  repoId: string;
  success: boolean;
  /** ok | already_up_to_date | squash_staged | conflict | error */
  status: string;
  message: string;
  conflictFiles: string[];
}

export interface RebaseResult {
  repoId: string;
  success: boolean;
  /** ok | already_up_to_date | conflict | error */
  status: string;
  message: string;
  conflictFiles: string[];
}

export interface ConflictFileView {
  path: string;
  content: string;
  hasMarkers: boolean;
}

export type ConflictStrategy = "ours" | "theirs" | "mark_resolved";

export interface SwitchOptions {
  stashIfDirty: boolean;
  fetchFirst: boolean;
  popStashAfter: boolean;
}

export interface SwitchResult {
  repoId: string;
  repoName: string;
  path: string;
  targetBranch: string;
  success: boolean;
  message: string;
  stashed: boolean;
}

export interface SwitchProgress {
  repoId: string;
  repoName: string;
  status: string;
  message: string;
}

export interface PullResult {
  repoId: string;
  repoName: string;
  path: string;
  success: boolean;
  message: string;
}

export interface SwitchPreviewItem {
  repoId: string;
  repoName: string;
  path: string;
  currentBranch: string | null;
  targetBranch: string;
  isDirty: boolean;
  action: string;
  detail: string;
}

export interface CommitResult {
  repoId: string;
  success: boolean;
  message: string;
}

export interface ChangedFile {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
}

export interface BranchInfo {
  /** Local short name, or remote ref like `origin/feature` */
  name: string;
  /** `"local"` | `"remote"` */
  kind: string;
  /** Local name without remote prefix */
  shortName: string;
  /** Configured upstream (e.g. origin/main). Local only. */
  upstream?: string | null;
  /** Commits ahead of upstream */
  ahead?: number | null;
  /** Commits behind upstream — pulls available when > 0 */
  behind?: number | null;
  /** Currently checked-out branch */
  isCurrent?: boolean;
  /** Upstream configured but remote ref gone */
  upstreamGone?: boolean;
}

export interface CommitLogEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  when: string;
  /** ISO 8601 author date for an exact timestamp tooltip / column */
  authoredAt?: string;
  /** Parent full hashes; first parent is the primary line */
  parents?: string[];
  /** Typed git decorations: head:, branch:, remote:, tag:, or other: */
  refs?: string[];
}
