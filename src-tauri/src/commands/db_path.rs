// tags.db 路径辅助：放在 exe 同级目录
// 数据库读写由 rusqlite 接管，前端不再调用此模块
use std::path::PathBuf;
use tauri::AppHandle;

/// 获取 tags.db 文件路径：exe 同级目录
pub fn db_file_path(_app: &AppHandle) -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "无法获取 exe 所在目录".to_string())?;
    Ok(dir.join("tags.db"))
}

/// 确保 tags.db 所在目录存在
pub fn ensure_data_dir(_app: &AppHandle) -> Result<(), String> {
    let path = db_file_path(_app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_db_path(app: AppHandle) -> Result<String, String> {
    Ok(db_file_path(&app)?.to_string_lossy().to_string())
}