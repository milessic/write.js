//! utils/themes.py for the themes server from the app settings: the registry is the allow-list of themes,
//! cached for ten minutes, retried a minute after a failure.
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

pub const THEMES_VERSION: &str = env!("WRITEJS_THEMES_VERSION");
pub const DEFAULT_THEME: &str = "writejs";
pub const THEME_COOKIE: &str = "theme";
const RETRY_AFTER: Duration = Duration::from_secs(60);
const REGISTRY_TTL: Duration = Duration::from_secs(600);

#[derive(Default)]
struct Cache {
    url: String,
    registry: Option<Value>,
    fetched_at: Option<Instant>,
    failed_at: Option<Instant>,
}

#[derive(Default)]
pub struct Themes {
    cache: Mutex<Cache>,
}

impl Themes {
    async fn registry(&self, http: &reqwest::Client, url: &str) -> Option<Value> {
        if url.is_empty() {
            return None;
        }
        let mut cache = self.cache.lock().await;
        if cache.url != url {
            // another themes server in the settings
            *cache = Cache { url: url.to_string(), ..Default::default() };
        }
        if cache.registry.is_some() && cache.fetched_at.is_some_and(|t| t.elapsed() < REGISTRY_TTL) {
            return cache.registry.clone();
        }
        if cache.failed_at.is_some_and(|t| t.elapsed() < RETRY_AFTER) {
            return cache.registry.clone();
        }
        let fetched = async {
            let resp = http.get(format!("{url}/api/themes")).timeout(Duration::from_secs(3)).send().await.ok()?;
            resp.error_for_status().ok()?.json::<Value>().await.ok()
        }
        .await;
        match fetched {
            Some(registry) => {
                cache.registry = Some(registry);
                cache.fetched_at = Some(Instant::now());
                cache.failed_at = None;
            }
            None => cache.failed_at = Some(Instant::now()),
        }
        cache.registry.clone()
    }

    /// template variables for rendering the theme into the page, as theme_context in utils/themes.py
    pub async fn context(&self, http: &reqwest::Client, url: &str, requested: Option<&str>) -> Value {
        let registry = self.registry(http, url).await;
        let known = |key: &str| match &registry {
            Some(reg) => reg["themes"].as_array().is_some_and(|t| t.iter().any(|t| t["key"] == key)),
            None => key == DEFAULT_THEME,
        };
        let theme = requested.filter(|k| known(k)).unwrap_or(DEFAULT_THEME);
        let backup = format!("static/themes/{DEFAULT_THEME}.css?v={THEMES_VERSION}");
        let available = registry.is_some();
        json!({
            "theme": theme,
            "themes_available": available,
            "themes_url": url,
            "themes_version": THEMES_VERSION,
            "theme_stylesheet": if available { format!("{url}/css/bundle/{theme}.css?v={THEMES_VERSION}") } else { backup.clone() },
            "theme_backup_stylesheet": backup,
            "default_theme": DEFAULT_THEME,
        })
    }
}
