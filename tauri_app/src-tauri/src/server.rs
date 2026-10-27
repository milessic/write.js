//! The local server the app's windows load Write.JS from, on one fixed origin (http://127.0.0.1:38211), so the
//! page, its localStorage and its cookies are the same on every start:
//! - "/", "/privacy", "/terms", "/favicon.svg", "/sw.js" and "/static/..." are rendered from static/ as
//!   routers/web.py does
//! - "/api/..." is passed to the Write.JS server from the app settings, its cookies rewritten for this origin,
//!   so the page talks to the cloud exactly as it does in a browser
//! - "/__writejs_app__/..." is the app's own: its settings, the folders opened as notebooks (notebooks.rs) and saving
//!   files; only the app's pages can use it, they get a token rendered into them (static/localnotebooks.js)
use crate::{
    notebooks::{FolderStore, LocalNotebooks, NotebookError, WriteDocument},
    settings::{normalize_url, AppSettings, LocalNotebookEntry},
    themes::{Themes, THEME_COOKIE},
};
use axum::{
    body::{Body, Bytes},
    extract::{Path as UrlPath, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{any, get, post, put},
    Json, Router,
};
use base64::Engine;
use futures_util::{Stream, StreamExt, TryStreamExt};
use md5::{Digest, Md5};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    convert::Infallible,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
    time::SystemTime,
};

pub const DEFAULT_PORT: u16 = 38211;
pub const APP_PREFIX: &str = "/__writejs_app__";
const LEGAL_UPDATED: &str = env!("WRITEJS_LEGAL_UPDATED");
const TOKEN_HEADER: &str = "x-writejs-app";
const CLIENT_HEADER: &str = "x-writejs-client";
/// headers of one connection, not passed through the proxy
const HOP_BY_HOP: &[&str] = &[
    "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "trailer", "te",
    "proxy-authenticate", "proxy-authorization",
];

/// what only the app can do natively: the windows' dialogs, the file manager
pub trait Native: Send + Sync + 'static {
    fn pick_folder(&self) -> Option<PathBuf>;
    fn save_file(&self, file_name: &str) -> Option<PathBuf>;
    fn reveal(&self, path: &Path);
    /// with the app the system opens it with
    fn open_path(&self, path: &Path) -> Result<(), String>;
    /// selected in the system's file manager (Finder, File Explorer...)
    fn show_in_folder(&self, path: &Path) -> Result<(), String>;
}

pub struct AppState {
    pub port: u16,
    pub token: String,
    pub static_dir: PathBuf,
    pub settings: RwLock<AppSettings>,
    http: reqwest::Client,
    themes: Themes,
    notebooks: LocalNotebooks,
    native: Box<dyn Native>,
    /// static file -> (mtime, hash), rehashed only when the file changes on disk (utils/static_files.py)
    hashes: Mutex<HashMap<String, (SystemTime, String)>>,
}

type AppResult<T> = Result<T, ApiError>;

pub struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "detail": self.1 }))).into_response()
    }
}

impl From<NotebookError> for ApiError {
    fn from(err: NotebookError) -> Self {
        ApiError(StatusCode::from_u16(err.0).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), err.1)
    }
}

impl AppState {
    pub fn new(port: u16, static_dir: PathBuf, settings: AppSettings, native: Box<dyn Native>) -> Arc<Self> {
        let token: String = {
            use rand::Rng;
            let bytes: [u8; 24] = rand::rng().random();
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
        };
        Arc::new(AppState {
            port,
            token,
            static_dir,
            settings: RwLock::new(settings),
            http: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("write.js desktop")
                .build()
                .expect("http client"),
            themes: Themes::default(),
            notebooks: LocalNotebooks::default(),
            native,
            hashes: Mutex::default(),
        })
    }

    pub fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn settings(&self) -> AppSettings {
        self.settings.read().unwrap().clone()
    }

    fn static_url(&self, path: &str) -> Result<String, minijinja::Error> {
        let file = self.static_dir.join(path);
        let not_found = || minijinja::Error::new(minijinja::ErrorKind::InvalidOperation, format!("static/{path} not found"));
        let mtime = std::fs::metadata(&file).and_then(|m| m.modified()).map_err(|_| not_found())?;
        let mut hashes = self.hashes.lock().unwrap();
        if hashes.get(path).is_none_or(|(t, _)| *t != mtime) {
            let bytes = std::fs::read(&file).map_err(|_| not_found())?;
            let hash = format!("{:x}", Md5::digest(&bytes));
            hashes.insert(path.to_string(), (mtime, hash[..10].to_string()));
        }
        Ok(format!("static/{path}?v={}", hashes[path].1))
    }

    fn notebook_entry(&self, id: &str) -> AppResult<LocalNotebookEntry> {
        self.settings()
            .notebooks
            .into_iter()
            .find(|n| n.id == id)
            .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "No such notebook".into()))
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    let app_api = Router::new()
        .route("/settings", get(get_settings).put(put_settings))
        .route("/notebooks", get(list_notebooks).post(add_notebook))
        .route("/notebooks/{id}", axum::routing::patch(update_notebook).delete(remove_notebook))
        .route("/notebooks/{id}/data", get(notebook_data))
        .route("/notebooks/{id}/documents", put(write_document))
        .route("/notebooks/{id}/documents/content", get(document_content))
        .route("/notebooks/{id}/documents/delete", post(delete_document))
        .route("/notebooks/{id}/folders", put(write_folders))
        .route("/notebooks/{id}/folders/rename", post(rename_folder))
        .route("/notebooks/{id}/folders/delete", post(delete_folder))
        .route("/notebooks/{id}/files/open", post(adopt_file))
        .route("/notebooks/{id}/files/system", post(open_with_system))
        .route("/notebooks/{id}/files/show", post(show_in_folder))
        .route("/notebooks/{id}/files/raw", get(raw_file))
        .route("/notebooks/{id}/files/image", get(converted_image))
        .route("/notebooks/{id}/reveal", post(reveal_notebook))
        .route("/notebooks/{id}/events", get(notebook_events))
        .route("/save", post(save_file))
        // the folder's documents and the exports can be of any size, not only localStorage's
        .layer(axum::extract::DefaultBodyLimit::disable())
        .layer(middleware::from_fn_with_state(state.clone(), require_token));
    Router::new()
        .route("/", get(index))
        .route("/privacy", get(|s| legal(s, "legal/privacy.html")))
        .route("/terms", get(|s| legal(s, "legal/terms.html")))
        .route("/favicon.svg", get(|State(s): State<Arc<AppState>>| async move { static_file(&s, "favicon.svg", false).await }))
        .route("/sw.js", get(service_worker))
        .route("/static/{*path}", get(static_route))
        .route("/api", any(proxy))
        .route("/api/{*rest}", any(proxy))
        .nest(APP_PREFIX, app_api)
        .layer(middleware::from_fn_with_state(state.clone(), local_only))
        .with_state(state)
}

/// another site's page could reach this server through a name pointing at 127.0.0.1 (DNS rebinding): only
/// requests for this origin's host are answered
async fn local_only(State(app): State<Arc<AppState>>, req: Request, next: Next) -> Response {
    let host = req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("");
    if host != format!("127.0.0.1:{}", app.port) && host != format!("localhost:{}", app.port) {
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(req).await
}

async fn require_token(State(app): State<Arc<AppState>>, req: Request, next: Next) -> Response {
    let header_token = req.headers().get(TOKEN_HEADER).and_then(|h| h.to_str().ok()).map(str::to_string);
    // an EventSource can't send headers
    let query_token = req.uri().query().and_then(|q| {
        q.split('&').find_map(|p| p.strip_prefix("token=")).map(|t| percent_encoding::percent_decode_str(t).decode_utf8_lossy().into_owned())
    });
    if header_token.or(query_token).as_deref() != Some(app.token.as_str()) {
        return ApiError(StatusCode::FORBIDDEN, "Not the app's page".into()).into_response();
    }
    next.run(req).await
}

// pages
fn cookies(headers: &HeaderMap) -> HashMap<String, String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|c| c.trim().split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
        .collect()
}

/// the user of an access token that has not expired. Its signature can only be checked by the Write.JS server,
/// which does so on every /api call; here it only decides which scripts the page loads, as in routers/web.py
fn jwt_subject(token: &str) -> Option<String> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let payload: Value = serde_json::from_slice(&bytes).ok()?;
    let now = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).ok()?.as_secs_f64();
    if payload["exp"].as_f64().is_some_and(|exp| exp < now) {
        return None;
    }
    Some(payload["sub"].as_str().unwrap_or("").to_string())
}

fn template_env(app: &Arc<AppState>) -> minijinja::Environment<'static> {
    let mut env = minijinja::Environment::new();
    let dir = app.static_dir.clone();
    // read on every render: a changed template shows on the next reload, as with the dev server
    env.set_loader(move |name| {
        if Path::new(name).components().any(|c| !matches!(c, Component::Normal(_))) {
            return Ok(None);
        }
        match std::fs::read_to_string(dir.join(name)) {
            Ok(source) => Ok(Some(source)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(minijinja::Error::new(minijinja::ErrorKind::TemplateNotFound, e.to_string())),
        }
    });
    let state = app.clone();
    env.add_function("static_url", move |path: String| state.static_url(&path).map(minijinja::Value::from_safe_string));
    env
}

async fn render(app: &Arc<AppState>, name: &str, headers: &HeaderMap, extra: Value) -> Response {
    let settings = app.settings();
    let cookies = cookies(headers);
    let mut context = app.themes.context(&app.http, &settings.themes_url, cookies.get(THEME_COOKIE).map(String::as_str)).await;
    if let (Value::Object(ctx), Value::Object(extra)) = (&mut context, extra) {
        ctx.extend(extra);
    }
    let html = template_env(app).get_template(name).and_then(|t| t.render(minijinja::value::Serde(&context)));
    match html {
        Ok(html) => ([(header::CACHE_CONTROL, "no-cache")], axum::response::Html(html)).into_response(),
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, format!("{err:#}")).into_response(),
    }
}

async fn index(State(app): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let settings = app.settings();
    // without a server nobody is logged in
    let username = cookies(&headers)
        .get("access_token")
        .filter(|_| !settings.server_url.is_empty())
        .and_then(|t| jwt_subject(t));
    let extra = json!({
        "is_authenticated": username.is_some(),
        "username": username.unwrap_or_default(),
        "desktop_app": true,
        "app_token": app.token,
    });
    render(&app, "index.html", &headers, extra).await
}

async fn legal(State(app): State<Arc<AppState>>, template: &'static str) -> Response {
    render(&app, template, &HeaderMap::new(), json!({ "updated": LEGAL_UPDATED })).await
}

async fn service_worker(State(app): State<Arc<AppState>>) -> Response {
    static_file(&app, "sw.js", false).await
}

async fn static_route(State(app): State<Arc<AppState>>, UrlPath(path): UrlPath<String>, Query(q): Query<HashMap<String, String>>) -> Response {
    static_file(&app, &path, q.contains_key("v")).await
}

async fn static_file(app: &AppState, path: &str, versioned: bool) -> Response {
    if Path::new(path).components().any(|c| !matches!(c, Component::Normal(_))) {
        return StatusCode::NOT_FOUND.into_response();
    }
    match tokio::fs::read(app.static_dir.join(path)).await {
        Ok(bytes) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            // as main.py: content-versioned files never change, everything else is revalidated
            let cache = if versioned { "public, max-age=31536000, immutable" } else { "no-cache" };
            ([(header::CONTENT_TYPE, mime.essence_str().to_string()), (header::CACHE_CONTROL, cache.to_string())], bytes).into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// the Write.JS server
/// a cookie of the Write.JS server for the local origin: no Domain, no Secure (http://127.0.0.1)
fn rewrite_set_cookie(value: &str) -> String {
    let mut parts: Vec<String> = vec![];
    let mut same_site = false;
    for (i, part) in value.split(';').map(str::trim).enumerate() {
        let lower = part.to_ascii_lowercase();
        if i > 0 && (lower.starts_with("domain=") || lower == "secure" || lower == "partitioned") {
            continue;
        }
        if i > 0 && lower.starts_with("samesite=") {
            same_site = true;
            parts.push("SameSite=Lax".into());
            continue;
        }
        parts.push(part.to_string());
    }
    if !same_site {
        parts.push("SameSite=Lax".into());
    }
    parts.join("; ")
}

async fn proxy(State(app): State<Arc<AppState>>, req: Request) -> Response {
    let server = app.settings().server_url;
    if server.is_empty() {
        return ApiError(StatusCode::SERVICE_UNAVAILABLE, "No Write.JS server is set, see Settings > Desktop app".into()).into_response();
    }
    let path = req.uri().path_and_query().map(|p| p.as_str()).unwrap_or("/api").to_string();
    let mut upstream = app.http.request(req.method().clone(), format!("{server}{path}"));
    for (name, value) in req.headers() {
        let n = name.as_str();
        if HOP_BY_HOP.contains(&n) || matches!(n, "host" | "origin" | "referer" | "accept-encoding" | "content-length") {
            continue;
        }
        upstream = upstream.header(name, value);
    }
    if !matches!(*req.method(), Method::GET | Method::HEAD) {
        let stream = req.into_body().into_data_stream().map_err(std::io::Error::other);
        upstream = upstream.body(reqwest::Body::wrap_stream(stream));
    }
    let resp = match upstream.send().await {
        Ok(resp) => resp,
        Err(err) => return ApiError(StatusCode::BAD_GATEWAY, format!("The Write.JS server can't be reached: {err}")).into_response(),
    };
    let mut response = Response::builder().status(resp.status().as_u16());
    for (name, value) in resp.headers() {
        let n = name.as_str();
        if HOP_BY_HOP.contains(&n) {
            continue;
        }
        let value = match n {
            "set-cookie" => value.to_str().ok().and_then(|v| HeaderValue::from_str(&rewrite_set_cookie(v)).ok()),
            // a redirect to the server itself stays on this origin
            "location" => value
                .to_str()
                .ok()
                .map(|v| v.strip_prefix(&server).map(|rest| if rest.is_empty() { "/" } else { rest }).unwrap_or(v).to_string())
                .and_then(|v| HeaderValue::from_str(&v).ok()),
            _ => Some(value.clone()),
        };
        if let Some(value) = value {
            response = response.header(name, value);
        }
    }
    response.body(Body::from_stream(resp.bytes_stream())).unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

// the app's API
async fn get_settings(State(app): State<Arc<AppState>>) -> Json<Value> {
    let s = app.settings();
    Json(json!({ "serverUrl": s.server_url, "themesUrl": s.themes_url, "configured": s.configured, "version": env!("CARGO_PKG_VERSION") }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsUpdate {
    server_url: String,
    themes_url: String,
}

async fn put_settings(State(app): State<Arc<AppState>>, Json(update): Json<SettingsUpdate>) -> AppResult<Json<Value>> {
    {
        let mut settings = app.settings.write().unwrap();
        settings.server_url = normalize_url(&update.server_url);
        settings.themes_url = normalize_url(&update.themes_url);
        settings.configured = true;
        settings.save().map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    Ok(get_settings(State(app)).await)
}

fn notebook_json(entry: &LocalNotebookEntry) -> Value {
    json!({ "id": entry.id, "name": entry.name, "path": entry.path, "newFormat": entry.new_format, "available": entry.path.is_dir() })
}

async fn list_notebooks(State(app): State<Arc<AppState>>) -> Json<Value> {
    Json(json!({ "notebooks": app.settings().notebooks.iter().map(notebook_json).collect::<Vec<_>>() }))
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct AddNotebook {
    /// without one, the folder is picked in a dialog
    path: Option<PathBuf>,
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

async fn add_notebook(State(app): State<Arc<AppState>>, body: Option<Json<AddNotebook>>) -> AppResult<Json<Value>> {
    let path = match body.and_then(|b| b.0.path) {
        Some(path) => Some(path),
        None => {
            let picker = app.clone();
            blocking(move || picker.native.pick_folder()).await?
        }
    };
    let Some(path) = path else { return Ok(Json(json!({ "notebook": null }))) };
    let path = std::fs::canonicalize(&path).map_err(|_| ApiError(StatusCode::BAD_REQUEST, format!("'{}' is not a folder", path.display())))?;
    // Windows' canonical paths start with \\?\, which nobody wants to read
    #[cfg(windows)]
    let path = path.to_str().and_then(|p| p.strip_prefix(r"\\?\")).map(PathBuf::from).unwrap_or(path);
    if !path.is_dir() {
        return Err(ApiError(StatusCode::BAD_REQUEST, format!("'{}' is not a folder", path.display())));
    }
    let mut settings = app.settings.write().unwrap();
    if let Some(entry) = settings.notebooks.iter().find(|n| n.path == path) {
        return Ok(Json(json!({ "notebook": notebook_json(entry) })));
    }
    let id = {
        use rand::Rng;
        format!("{:012x}", rand::rng().random::<u64>() & 0xffff_ffff_ffff)
    };
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
    let entry = LocalNotebookEntry { id, name, path, new_format: "html".into() };
    settings.notebooks.push(entry.clone());
    settings.save().map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "notebook": notebook_json(&entry) })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotebookUpdate {
    name: Option<String>,
    new_format: Option<String>,
}

async fn update_notebook(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>, Json(update): Json<NotebookUpdate>) -> AppResult<Json<Value>> {
    let mut settings = app.settings.write().unwrap();
    let entry = settings.notebooks.iter_mut().find(|n| n.id == id).ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "No such notebook".into()))?;
    if let Some(name) = update.name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) {
        entry.name = name;
    }
    if let Some(format) = update.new_format.filter(|f| f == "html" || f == "md") {
        entry.new_format = format;
    }
    let json = notebook_json(entry);
    settings.save().map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "notebook": json })))
}

/// off the list only, the folder and its files stay as they are
async fn remove_notebook(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>) -> AppResult<Json<Value>> {
    let mut settings = app.settings.write().unwrap();
    settings.notebooks.retain(|n| n.id != id);
    settings.save().map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    app.notebooks.close(&id);
    Ok(Json(json!({ "removed": id })))
}

async fn with_notebook<T: Send + 'static>(
    app: &Arc<AppState>,
    id: &str,
    f: impl FnOnce(Arc<crate::notebooks::Notebook>) -> Result<T, NotebookError> + Send + 'static,
) -> AppResult<T> {
    let entry = app.notebook_entry(id)?;
    let state = app.clone();
    Ok(blocking(move || state.notebooks.get(&entry).and_then(f)).await??)
}

fn client_of(headers: &HeaderMap) -> String {
    headers.get(CLIENT_HEADER).and_then(|h| h.to_str().ok()).unwrap_or("").to_string()
}

async fn notebook_data(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>) -> AppResult<Json<Value>> {
    Ok(Json(with_notebook(&app, &id, |nb| Ok(nb.data())).await?))
}

async fn write_document(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>, headers: HeaderMap, Json(doc): Json<WriteDocument>) -> AppResult<Json<Value>> {
    let origin = client_of(&headers);
    let version = with_notebook(&app, &id, move |nb| nb.write_document(doc, &origin)).await?;
    Ok(Json(json!({ "saved": true, "version": version })))
}

async fn document_content(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>, Query(q): Query<HashMap<String, String>>) -> AppResult<Json<Value>> {
    let name = q.get("name").cloned().unwrap_or_default();
    Ok(Json(with_notebook(&app, &id, move |nb| nb.document_content(&name)).await?))
}

#[derive(Deserialize)]
struct DeleteDocument {
    name: String,
}

async fn delete_document(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>, headers: HeaderMap, Json(req): Json<DeleteDocument>) -> AppResult<Json<Value>> {
    let origin = client_of(&headers);
    with_notebook(&app, &id, move |nb| nb.delete_document(&req.name, &origin)).await?;
    Ok(Json(json!({ "deleted": true })))
}

async fn write_folders(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>, headers: HeaderMap, Json(store): Json<FolderStore>) -> AppResult<Json<Value>> {
    let origin = client_of(&headers);
    with_notebook(&app, &id, move |nb| nb.write_folders(store, &origin)).await?;
    Ok(Json(json!({ "saved": true })))
}

#[derive(Deserialize)]
struct RenameFolder {
    from: String,
    to: String,
}

async fn rename_folder(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>, headers: HeaderMap, Json(req): Json<RenameFolder>) -> AppResult<Json<Value>> {
    let origin = client_of(&headers);
    with_notebook(&app, &id, move |nb| nb.rename_folder(&req.from, &req.to, &origin)).await?;
    Ok(Json(json!({ "renamed": true })))
}

#[derive(Deserialize)]
struct FolderPath {
    folder: String,
}

async fn delete_folder(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>, headers: HeaderMap, Json(req): Json<FolderPath>) -> AppResult<Json<Value>> {
    let origin = client_of(&headers);
    with_notebook(&app, &id, move |nb| nb.delete_folder(&req.folder, &origin)).await?;
    Ok(Json(json!({ "deleted": true })))
}

#[derive(Deserialize)]
struct FilePath {
    path: String,
}

async fn adopt_file(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>, headers: HeaderMap, Json(req): Json<FilePath>) -> AppResult<Json<Value>> {
    let origin = client_of(&headers);
    Ok(Json(with_notebook(&app, &id, move |nb| nb.adopt_file(&req.path, &origin)).await?))
}

async fn open_with_system(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>, Json(req): Json<FilePath>) -> AppResult<Json<Value>> {
    let path = with_notebook(&app, &id, move |nb| nb.path_of(&req.path)).await?;
    let state = app.clone();
    blocking(move || state.native.open_path(&path)).await?.map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("No app opens it: {e}")))?;
    Ok(Json(json!({ "opened": true })))
}

async fn show_in_folder(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>, Json(req): Json<FilePath>) -> AppResult<Json<Value>> {
    let path = with_notebook(&app, &id, move |nb| nb.path_of(&req.path)).await?;
    let state = app.clone();
    blocking(move || state.native.show_in_folder(&path)).await?.map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("Could not show it: {e}")))?;
    Ok(Json(json!({ "shown": true })))
}

/// a file of the notebook as it is, for the previews (an img, a video or PDF.js reads it, the token comes in the
/// query): streamed from the disk, in the ranges a video asks for, sandboxed so nothing in it runs on this origin
async fn raw_file(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>, Query(q): Query<HashMap<String, String>>, req: Request) -> AppResult<Response> {
    let rel = q.get("path").cloned().unwrap_or_default();
    let path = with_notebook(&app, &id, move |nb| nb.path_of(&rel)).await?;
    serve_file(&path, req).await
}

async fn serve_file(path: &Path, req: Request) -> AppResult<Response> {
    use tower::ServiceExt;
    let mut response = tower_http::services::ServeFile::new(path)
        .oneshot(req)
        .await
        .map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map(Body::new);
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'"));
    Ok(response)
}

/// a picture the web view can't show (HEIC, TIFF...) as a JPEG, made by a program of the system (image_converters);
/// kept in the temporary folder for as long as the file doesn't change
async fn converted_image(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>, Query(q): Query<HashMap<String, String>>, req: Request) -> AppResult<Response> {
    let rel = q.get("path").cloned().unwrap_or_default();
    let source = with_notebook(&app, &id, move |nb| nb.path_of(&rel)).await?;
    let converted = blocking(move || convert_image(&source)).await?.map_err(|e| ApiError(StatusCode::NOT_IMPLEMENTED, e))?;
    serve_file(&converted, req).await
}

/// the programs that turn a picture into a JPEG, the first one there is does it: {in} and {out} are the files.
/// WRITEJS_IMAGE_CONVERTER comes first (tests, or a program of one's own)
fn image_converters() -> Vec<Vec<String>> {
    let mut converters: Vec<Vec<String>> = vec![];
    if let Ok(own) = std::env::var("WRITEJS_IMAGE_CONVERTER") {
        converters.push(own.split_whitespace().map(str::to_string).collect());
    }
    let builtin: &[&str] = &[
        #[cfg(target_os = "macos")]
        "sips -s format jpeg {in} --out {out}",
        "heif-convert -q 90 {in} {out}",
        "magick {in} {out}",
        #[cfg(not(windows))]
        "convert {in} {out}",
        "ffmpeg -y -loglevel error -i {in} {out}",
    ];
    converters.extend(builtin.iter().map(|c| c.split(' ').map(str::to_string).collect()));
    converters
}

fn convert_image(source: &Path) -> Result<PathBuf, String> {
    let meta = std::fs::metadata(source).map_err(|e| e.to_string())?;
    let key = format!("{}|{:?}|{}", source.display(), meta.modified().ok(), meta.len());
    let dir = std::env::temp_dir().join("writejs-previews");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(format!("{:x}.jpg", Md5::digest(key.as_bytes())));
    if target.is_file() {
        return Ok(target);
    }
    let partial = target.with_extension("part.jpg");
    for converter in image_converters() {
        let args: Vec<std::ffi::OsString> = converter[1..]
            .iter()
            .map(|a| match a.as_str() {
                "{in}" => source.as_os_str().to_owned(),
                "{out}" => partial.as_os_str().to_owned(),
                _ => a.into(),
            })
            .collect();
        let done = std::process::Command::new(&converter[0])
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        if done && partial.is_file() {
            std::fs::rename(&partial, &target).map_err(|e| e.to_string())?;
            return Ok(target);
        }
    }
    let _ = std::fs::remove_file(&partial);
    Err("No program to convert it is installed (on Linux: libheif's heif-convert or ImageMagick)".into())
}

async fn reveal_notebook(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>) -> AppResult<Json<Value>> {
    let entry = app.notebook_entry(&id)?;
    let state = app.clone();
    blocking(move || state.native.reveal(&entry.path)).await?;
    Ok(Json(json!({ "revealed": true })))
}

async fn notebook_events(State(app): State<Arc<AppState>>, UrlPath(id): UrlPath<String>) -> AppResult<Sse<impl Stream<Item = Result<Event, Infallible>>>> {
    let receiver = with_notebook(&app, &id, |nb| Ok(nb.events.subscribe())).await?;
    let stream = tokio_stream::wrappers::BroadcastStream::new(receiver)
        .filter_map(|msg| async move { msg.ok().map(|data| Ok(Event::default().event("changed").data(data))) });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

/// a file the page exports (a document, a notebook backup): saved where the user picks
async fn save_file(State(app): State<Arc<AppState>>, Query(q): Query<HashMap<String, String>>, body: Bytes) -> AppResult<Json<Value>> {
    let name = q.get("name").cloned().unwrap_or_else(|| "download".into());
    let state = app.clone();
    let Some(path) = blocking(move || state.native.save_file(&name)).await? else {
        return Ok(Json(json!({ "path": null })));
    };
    tokio::fs::write(&path, &body).await.map_err(|e| ApiError(StatusCode::INTERNAL_SERVER_ERROR, format!("Could not save '{}': {e}", path.display())))?;
    Ok(Json(json!({ "path": path })))
}

/// static/ of the repo, the copy bundled with the app, or WRITEJS_STATIC
pub fn find_static_dir(bundled: Option<PathBuf>) -> PathBuf {
    if let Some(dir) = std::env::var_os("WRITEJS_STATIC") {
        return dir.into();
    }
    if let Some(dir) = bundled.filter(|d| d.join("index.html").is_file()) {
        return dir;
    }
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../static")
}

pub async fn serve(state: Arc<AppState>, listener: tokio::net::TcpListener) {
    if let Err(err) = axum::serve(listener, router(state)).await {
        eprintln!("Write.JS local server stopped: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookies_are_rewritten_for_the_local_origin() {
        assert_eq!(
            rewrite_set_cookie("access_token=abc; Domain=example.com; HttpOnly; Max-Age=60; Path=/; SameSite=None; Secure"),
            "access_token=abc; HttpOnly; Max-Age=60; Path=/; SameSite=Lax"
        );
        assert_eq!(rewrite_set_cookie("theme=dark; Path=/"), "theme=dark; Path=/; SameSite=Lax");
    }

    #[test]
    fn expired_tokens_have_no_user() {
        let encode = |v: Value| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(v.to_string());
        assert_eq!(jwt_subject(&format!("h.{}.s", encode(json!({"sub": "ann", "exp": 4102444800u64})))), Some("ann".into()));
        assert_eq!(jwt_subject(&format!("h.{}.s", encode(json!({"sub": "ann", "exp": 1})))), None);
        assert_eq!(jwt_subject("garbage"), None);
    }
}
