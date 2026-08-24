use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub root_path: Option<String>,
    pub repo_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub id: String,
    pub project_id: String,
    pub path: String,
    pub name: String,
    pub enabled: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    pub project: Project,
    pub repos: Vec<Repo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentBranch {
    pub environment_id: String,
    pub repo_id: String,
    pub branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedRepo {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub name: String,
    pub root_path: Option<String>,
    pub repo_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub repo_id: String,
    pub path: String,
    pub current_branch: Option<String>,
    pub is_detached: bool,
    pub is_dirty: bool,
    /// Commits ahead of upstream (None if no upstream)
    pub ahead: Option<i64>,
    /// Commits behind upstream (None if no upstream)
    pub behind: Option<i64>,
    /// Latest commit subject
    pub last_commit: Option<String>,
    /// Relative time e.g. "2 hours ago"
    pub last_commit_at: Option<String>,
    /// True when MERGE_HEAD exists (merge in progress)
    #[serde(default)]
    pub is_merging: bool,
    /// True when a rebase is in progress
    #[serde(default)]
    pub is_rebasing: bool,
    /// Paths with unresolved merge/rebase conflicts (UU etc.)
    #[serde(default)]
    pub conflict_files: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRequest {
    pub repo_id: String,
    /// Branch or ref to merge into the current branch
    pub source_branch: String,
    /// If true, use --no-ff
    #[serde(default)]
    pub no_ff: bool,
    /// If true, use --squash (stages result, does not commit)
    #[serde(default)]
    pub squash: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub repo_id: String,
    pub success: bool,
    /// ok | already_up_to_date | conflict | error | squash_staged
    pub status: String,
    pub message: String,
    #[serde(default)]
    pub conflict_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseRequest {
    pub repo_id: String,
    /// Branch/ref to rebase onto (e.g. main, origin/main)
    pub onto_branch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseResult {
    pub repo_id: String,
    pub success: bool,
    /// ok | already_up_to_date | conflict | error
    pub status: String,
    pub message: String,
    #[serde(default)]
    pub conflict_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveConflictRequest {
    pub repo_id: String,
    pub path: String,
    /// ours | theirs | mark_resolved
    pub strategy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFileView {
    pub path: String,
    /// Raw working-tree content (may include conflict markers)
    pub content: String,
    pub has_markers: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchOptions {
    /// If true, `git stash push -u` before checkout when dirty
    pub stash_if_dirty: bool,
    /// If true, `git fetch --all --prune` before checkout
    pub fetch_first: bool,
    /// If true and we stashed for this repo, run `git stash pop` after successful checkout
    pub pop_stash_after: bool,
}

impl Default for SwitchOptions {
    fn default() -> Self {
        Self {
            stash_if_dirty: false,
            fetch_first: false,
            pop_stash_after: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchResult {
    pub repo_id: String,
    pub repo_name: String,
    pub path: String,
    pub target_branch: String,
    pub success: bool,
    pub message: String,
    pub stashed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchProgress {
    pub repo_id: String,
    pub repo_name: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResult {
    pub repo_id: String,
    pub repo_name: String,
    pub path: String,
    pub success: bool,
    pub message: String,
    /// up_to_date | fast_forwarded | merged | conflict | merge_in_progress | needs_merge
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ahead: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub behind: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_head: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_head: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conflict_files: Vec<String>,
}

/// Fetch-backed preview shown before a single-repository pull.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullPreview {
    pub repo_id: String,
    pub repo_name: String,
    pub path: String,
    pub branch: String,
    pub upstream: String,
    pub current_head: String,
    pub ahead: i64,
    pub behind: i64,
    /// up_to_date | fast_forward | merge
    pub action: String,
    pub message: String,
}

/// Shared shape for pull / push / fetch batch ops
pub type BatchGitResult = PullResult;

/// Planned action for dry-run switch preview
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchPreviewItem {
    pub repo_id: String,
    pub repo_name: String,
    pub path: String,
    pub current_branch: Option<String>,
    pub target_branch: String,
    pub is_dirty: bool,
    /// ok | skip | will_switch | will_stash | will_fail | no_target
    pub action: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRequest {
    pub repo_id: String,
    pub message: String,
    /// If true, `git add -A` before commit
    pub stage_all: bool,
    /// If set (and not stage_all), stage only these paths then commit
    pub paths: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub repo_id: String,
    pub success: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    /// Short code e.g. M, A, D, ?, R
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    /// Display / checkout ref: local short name, or remote like `origin/feature`
    pub name: String,
    /// `"local"` or `"remote"`
    pub kind: String,
    /// Local name without remote prefix (for remotes: `feature` from `origin/feature`)
    pub short_name: String,
    /// Configured upstream ref (e.g. origin/main). Local branches only.
    #[serde(default)]
    pub upstream: Option<String>,
    /// Commits ahead of upstream (None if no upstream / not computed)
    #[serde(default)]
    pub ahead: Option<i64>,
    /// Commits behind upstream — pulls available when > 0
    #[serde(default)]
    pub behind: Option<i64>,
    /// True when this is the currently checked-out branch
    #[serde(default)]
    pub is_current: bool,
    /// Upstream is configured but remote ref is gone
    #[serde(default)]
    pub upstream_gone: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitLogEntry {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub when: String,
    /// Exact ISO 8601 author timestamp.
    pub authored_at: String,
    /// Parent commit hashes (full), first parent is primary line
    #[serde(default)]
    pub parents: Vec<String>,
    /// Typed decorations: head:, branch:, remote:, tag:, or other:.
    #[serde(default)]
    pub refs: Vec<String>,
}
