//! The app's own settings (not Write.JS's, those are in the page's localStorage), kept as settings.json
//! in the app's config folder: the Write.JS server, the themes server and the folders opened as notebooks.
//! An empty server_url: no cloud, the documents stay on this device. An empty themes_url: the bundled Write.js theme.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalNotebookEntry {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    /// the format of new documents: "html" (every feature of the editor) or "md"
    #[serde(default = "default_new_format")]
    pub new_format: String,
}

fn default_new_format() -> String {
    "html".into()
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub server_url: String,
    pub themes_url: String,
    /// false until the settings were saved once: the page asks for them on the first start
    pub configured: bool,
    pub notebooks: Vec<LocalNotebookEntry>,
}

/// "example.com/" -> "https://example.com", "" stays empty
pub fn normalize_url(url: &str) -> String {
    let url = url.trim().trim_end_matches('/');
    if url.is_empty() || url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        format!("https://{url}")
    }
}

pub fn config_dir() -> PathBuf {
    std::env::var_os("WRITEJS_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("writejs"))
}

impl AppSettings {
    fn path() -> PathBuf {
        config_dir().join("settings.json")
    }

    /// settings.json, with WRITEJS_SERVER and WRITEJS_THEMES overriding it (tests, development)
    pub fn load() -> Self {
        let mut settings: AppSettings =
            fs::read_to_string(Self::path()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        if let Ok(url) = std::env::var("WRITEJS_SERVER") {
            settings.server_url = url;
            settings.configured = true;
        }
        if let Ok(url) = std::env::var("WRITEJS_THEMES") {
            settings.themes_url = url;
        }
        settings.server_url = normalize_url(&settings.server_url);
        settings.themes_url = normalize_url(&settings.themes_url);
        settings
    }

    pub fn save(&self) -> std::io::Result<()> {
        let path = Self::path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        write_atomic(&path, serde_json::to_string_pretty(self)?.as_bytes())
    }
}

/// written next to the file and renamed over it: a crash never leaves half a file
pub fn write_atomic(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.writejs-tmp"));
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}
