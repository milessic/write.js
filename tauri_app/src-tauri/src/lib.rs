//! Write.JS as a native app: the web app from static/, served by a local server (server.rs) and shown in the
//! system's web view, with the browser's parts it relies on done natively: new windows (a document's window, the
//! legal pages), links to other sites (the system's browser), saving files and picking folders (dialogs).
pub mod notebooks;
pub mod server;
pub mod settings;
pub mod themes;

use server::{AppState, Native};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

struct TauriNative(AppHandle);

/// dialogs belong to the window they were asked from
fn focused_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let windows = app.webview_windows();
    windows.values().find(|w| w.is_focused().unwrap_or(false)).or_else(|| windows.get("main")).cloned()
}

impl Native for TauriNative {
    fn pick_folder(&self) -> Option<PathBuf> {
        let mut dialog = self.0.dialog().file().set_title("Open a folder as a notebook");
        if let Some(window) = focused_window(&self.0) {
            dialog = dialog.set_parent(&window);
        }
        dialog.blocking_pick_folder().and_then(|p| p.into_path().ok())
    }

    fn save_file(&self, file_name: &str) -> Option<PathBuf> {
        let mut dialog = self.0.dialog().file().set_file_name(file_name);
        if let Some(dir) = dirs::download_dir() {
            dialog = dialog.set_directory(dir);
        }
        if let Some(window) = focused_window(&self.0) {
            dialog = dialog.set_parent(&window);
        }
        dialog.blocking_save_file().and_then(|p| p.into_path().ok())
    }

    fn reveal(&self, path: &Path) {
        let _ = tauri_plugin_opener::open_path(path, None::<&str>);
    }
}

fn is_local(url: &Url, origin: &str) -> bool {
    url.origin().ascii_serialization() == origin || url.scheme() == "about" || url.scheme() == "blob" || url.scheme() == "data"
}

/// a window of the app: a page of this origin; links to other sites open in the system's browser
fn open_window(app: &AppHandle, url: Url) -> tauri::Result<tauri::WebviewWindow> {
    static WINDOWS: AtomicUsize = AtomicUsize::new(0);
    let label = match WINDOWS.fetch_add(1, Ordering::Relaxed) {
        0 => "main".to_string(),
        n => format!("window-{n}"),
    };
    let origin = app.state::<Arc<AppState>>().origin();
    let (nav_origin, new_origin, handle) = (origin.clone(), origin, app.clone());
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title("Write.JS")
        .inner_size(1280.0, 860.0)
        .min_inner_size(360.0, 400.0)
        .on_navigation(move |url| {
            if is_local(url, &nav_origin) {
                return true;
            }
            let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            false
        })
        .on_new_window(move |url, _features| {
            // window.open and target="_blank": a page of the app gets a window of its own, the rest the browser
            if url.origin().ascii_serialization() == new_origin {
                let app = handle.clone();
                // windows can't be made from inside this handler on every system
                tauri::async_runtime::spawn(async move {
                    let _ = open_window(&app, url);
                });
            } else {
                let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()
}

pub fn run() {
    let port = std::env::var("WRITEJS_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(server::DEFAULT_PORT);
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // started again: the running app comes to the front
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let handle = app.handle().clone();
            let bundled = app.path().resource_dir().ok().map(|d| d.join("static"));
            let state = AppState::new(port, server::find_static_dir(bundled), settings::AppSettings::load(), Box::new(TauriNative(handle.clone())));
            app.manage(state.clone());
            // the origin is fixed: the documents in the page's storage belong to it
            let listener = match std::net::TcpListener::bind(("127.0.0.1", port)) {
                Ok(listener) => listener,
                Err(err) => {
                    handle
                        .dialog()
                        .message(format!("Write.JS can't start its local server on port {port}: {err}\n\nIs another program using it?"))
                        .kind(MessageDialogKind::Error)
                        .title("Write.JS")
                        .blocking_show();
                    std::process::exit(1);
                }
            };
            listener.set_nonblocking(true)?;
            tauri::async_runtime::spawn(async move {
                let listener = tokio::net::TcpListener::from_std(listener).expect("listener");
                server::serve(state, listener).await;
            });
            open_window(&handle, format!("http://127.0.0.1:{port}/").parse()?)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Write.JS");
}
