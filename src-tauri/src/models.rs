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
    pub error: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResult {
    pub repo_id: String,
    pub repo_name: String,
    pub path: String,
    pub success: bool,
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
pub struct CommitLogEntry {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
    pub when: String,
}
