mod commands;
mod db;
mod git;
mod models;
mod scan;

use commands::AppState;
use db::Db;
use std::sync::Arc;
use tauri::Manager;

/// WebKitGTK on Linux (especially NVIDIA) often fails with:
/// `Failed to create GBM buffer ... Permission denied` and a blank window.
/// Disable DMA-BUF / compositing before any webview is created.
fn apply_linux_webview_workarounds() {
    #[cfg(target_os = "linux")]
    {
        // Prefer software-friendly paths when unset so user overrides still work.
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    apply_linux_webview_workarounds();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| Box::<dyn std::error::Error>::from(e.to_string()))?;
            std::fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("git-workspace.db");
            let db = Db::open(&db_path)
                .map_err(|e| Box::<dyn std::error::Error>::from(e))?;
            app.manage(AppState { db: Arc::new(db) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::get_project,
            commands::create_project,
            commands::delete_project,
            commands::scan_repos,
            commands::add_repo,
            commands::remove_repo,
            commands::set_repo_enabled,
            commands::list_environments,
            commands::create_environment,
            commands::update_environment,
            commands::delete_environment,
            commands::get_environment_map,
            commands::set_environment_branch,
            commands::get_repo_status,
            commands::get_project_repo_statuses,
            commands::list_branches,
            commands::list_project_branches,
            commands::checkout_branch,
            commands::switch_environment,
            commands::preview_switch_environment,
            commands::pull_all,
            commands::preview_pull,
            commands::fetch_all_repos,
            commands::push_all,
            commands::pull_repo,
            commands::push_repo,
            commands::fetch_repo,
            commands::get_change_summary,
            commands::list_changed_files,
            commands::stage_files,
            commands::unstage_files,
            commands::discard_files,
            commands::commit_repo,
            commands::get_commit_log,
            commands::get_repo_path,
            commands::create_branch,
            commands::delete_branch,
            commands::merge_branch,
            commands::merge_abort,
            commands::rebase_onto,
            commands::rebase_continue,
            commands::rebase_abort,
            commands::rebase_skip,
            commands::resolve_conflict,
            commands::read_conflict_file,
            commands::checkout_commit,
            commands::get_file_diff,
            commands::get_setting,
            commands::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
