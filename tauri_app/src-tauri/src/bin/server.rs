//! The app's local server without a window, for the browser tests (tests/e2e/test_desktop_*.py) and development:
//! the dialogs are answered from the environment, WRITEJS_PICK_FOLDER (the folder "picked") and WRITEJS_SAVE_DIR
//! (where saved files go); files opened with the system's app are listed in WRITEJS_OPEN_LOG. WRITEJS_PORT, WRITEJS_CONFIG_DIR, WRITEJS_SERVER, WRITEJS_THEMES and WRITEJS_STATIC as in the app.
use std::path::{Path, PathBuf};
use writejs_lib::{
    server::{self, AppState, Native},
    settings::AppSettings,
};

struct Headless;

impl Native for Headless {
    fn pick_folder(&self) -> Option<PathBuf> {
        std::env::var_os("WRITEJS_PICK_FOLDER").map(PathBuf::from)
    }

    fn save_file(&self, file_name: &str) -> Option<PathBuf> {
        std::env::var_os("WRITEJS_SAVE_DIR").map(|dir| PathBuf::from(dir).join(file_name))
    }

    fn reveal(&self, path: &Path) {
        println!("reveal {}", path.display());
    }

    /// written to WRITEJS_OPEN_LOG, one path a line
    fn open_path(&self, path: &Path) -> Result<(), String> {
        log_opened("open", path)
    }

    fn show_in_folder(&self, path: &Path) -> Result<(), String> {
        log_opened("show", path)
    }
}

fn log_opened(what: &str, path: &Path) -> Result<(), String> {
    use std::io::Write;
    let log = std::env::var_os("WRITEJS_OPEN_LOG").ok_or("no WRITEJS_OPEN_LOG")?;
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(log).map_err(|e| e.to_string())?;
    writeln!(file, "{what} {}", path.display()).map_err(|e| e.to_string())
}

#[tokio::main]
async fn main() {
    let port = std::env::var("WRITEJS_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(server::DEFAULT_PORT);
    let state = AppState::new(port, server::find_static_dir(None), AppSettings::load(), Box::new(Headless));
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.expect("port");
    println!("Write.JS local server on {}", state.origin());
    // the token goes to the tests on stdout; the page gets it rendered in
    println!("token {}", state.token);
    server::serve(state, listener).await;
}
