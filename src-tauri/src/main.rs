// 防止 Windows 发布版本中弹出额外的控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    file_tag_browser_v2_lib::run()
}