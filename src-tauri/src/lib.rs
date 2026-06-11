mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            // 文件系统 IO
            commands::fs::scan_folder,
            commands::fs::stat_path,
            // 文件夹 UUID.tag
            commands::folder_tag::create_folder_tag_file,
            commands::folder_tag::read_folder_tag,
            // hash
            commands::hash::compute_file_hash,
            // 驱动器
            commands::drives::get_drives,
            // 对话框与打开文件
            commands::dialog::open_folder_dialog,
            commands::dialog::open_file,
            commands::dialog::open_in_explorer,
            // 数据库路径
            commands::db_path::get_db_path,
            // 数据库 CRUD
            commands::db::get_file_tags_by_paths,
            commands::db::get_scanned_files,
            commands::db::search_by_tag,
            commands::db::get_tag_groups,
            commands::db::create_tag_group,
            commands::db::update_tag_group,
            commands::db::delete_tag_group,
            commands::db::update_tag_group_order,
            commands::db::get_tags,
            commands::db::create_tag,
            commands::db::delete_tag,
            commands::db::update_tag_order,
            commands::db::add_file_tag,
            commands::db::remove_file_tag,
            commands::db::delete_file,
            commands::db::batch_add_tags,
            commands::db::batch_remove_tags,
            commands::db::sync_folder,
            commands::db::remap_folder_tags,
        ])
        .setup(|app| {
            commands::db_path::ensure_data_dir(app.handle())?;
            commands::db::init_db(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动失败");
}