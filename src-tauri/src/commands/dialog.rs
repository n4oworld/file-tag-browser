// 对话框与打开文件命令
// 通过 Tauri plugin-dialog / plugin-shell 实现
use std::process::Command;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

/// 弹出系统目录选择框，返回所选目录路径或 None
#[tauri::command]
pub async fn open_folder_dialog(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path.map(|p| p.to_string()));
    });
    rx.recv().map_err(|e| e.to_string())
}

/// 使用系统默认程序打开文件
#[allow(deprecated)]
#[tauri::command]
pub async fn open_file(app: AppHandle, path: String) -> Result<(), String> {
    app.shell()
        .open(path, None)
        .map_err(|e| e.to_string())
        .map(|_| ())
}

/// 用 Windows 资源管理器打开目录
/// 路径不合法或目录不存在时返回错误
#[tauri::command]
pub async fn open_in_explorer(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("路径不存在: {}", path));
    }
    // explorer 在 Windows 上总是存在；macOS 用 open，Linux 用 xdg-open
    #[cfg(windows)]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("启动 explorer 失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("启动 open 失败: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("启动 xdg-open 失败: {}", e))?;
    }
    Ok(())
}