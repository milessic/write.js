//! Folders of this computer opened as notebooks (the page's side is static/localnotebooks.js).
//! A notebook's folders are the sub-folders of its folder, up to MAX_FOLDER_DEPTH levels, and its documents are
//! the .html (a Write.JS document as the editor stores it), .md / .markdown and text files (.txt, .csv, .json, .yaml,
//! code... TEXT_EXTENSIONS) in them; hidden files and folders (".name") are left out. The other files are listed too
//! (files), they can be opened with the system's app, or tried as text: a text file is a document from then on.
//! A document is named by its file, without the extension for .html, Markdown and .txt. Documents have one name in
//! a notebook: a name taken by a file of another folder gets " (2)", " (3)"... The page keeps documents by name and a folder for each, this module keeps where
//! each one is on the disk: a new document is written into its folder, a document moved to another folder is moved
//! there, a deleted one goes to the trash. Nothing of a notebook goes to the Write.JS server.
//!
//! What the files can't hold goes to `.writejs/notebook.json` in the notebook's folder, written only when there is
//! something to keep: the folders' colors and, for Markdown and text documents, their ids (links between documents)
//! and metadata.
//!
//! The folder is watched: a change made outside of the app is told to the opened pages (events), which load the
//! notebook again; so is a change one page made, to the other windows.
use crate::settings::{write_atomic, LocalNotebookEntry};
use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
    time::{Duration, SystemTime},
};
use tokio::sync::{broadcast, mpsc};

/// maxFolderDepth in static/workspace.js
pub const MAX_FOLDER_DEPTH: usize = 5;
/// bigger files aren't notes, they are left out
const MAX_FILE_SIZE: u64 = 8 * 1024 * 1024;
const SIDECAR_DIR: &str = ".writejs";
const SIDECAR_FILE: &str = "notebook.json";
/// changes on the disk are looked at once they have settled for this long
const WATCH_SETTLE: Duration = Duration::from_millis(400);

#[derive(Debug)]
pub struct NotebookError(pub u16, pub String);

impl<E: std::fmt::Display> From<E> for NotebookError {
    fn from(err: E) -> Self {
        NotebookError(500, err.to_string())
    }
}

type Result<T> = std::result::Result<T, NotebookError>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Html,
    Md,
    Txt,
}

/// opened as plain text, besides .txt: data, code, logs...
pub const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "text", "log", "csv", "tsv", "json", "jsonc", "json5", "ndjson", "yaml", "yml", "toml", "ini", "cfg", "conf",
    "env", "properties", "xml", "plist", "rst", "adoc", "asciidoc", "org", "tex", "bib", "js", "mjs", "cjs", "ts", "tsx",
    "jsx", "py", "rb", "rs", "go", "java", "kt", "kts", "scala", "c", "h", "cpp", "cc", "hpp", "cs", "php", "pl", "swift",
    "dart", "lua", "r", "sql", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "css", "scss", "sass", "less", "vue",
    "svelte", "graphql", "gql", "proto", "gradle", "mk", "diff", "patch", "srt", "vtt",
];
/// text files known by their name, they have no extension
const TEXT_NAMES: &[&str] = &[
    "readme", "license", "licence", "changelog", "authors", "contributing", "notice", "todo", "makefile", "dockerfile",
    "procfile", "gemfile", "rakefile", "vagrantfile", "jenkinsfile",
];
/// named without their extension: the notebook's own kinds of documents
const PLAIN_NAMED: &[&str] = &["html", "htm", "md", "markdown", "txt"];

fn extension_of(file_name: &str) -> Option<String> {
    Path::new(file_name).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase)
}

impl Format {
    fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_ascii_lowercase().as_str() {
            "html" | "htm" => Some(Format::Html),
            "md" | "markdown" => Some(Format::Md),
            ext if TEXT_EXTENSIONS.contains(&ext) => Some(Format::Txt),
            _ => None,
        }
    }

    /// the format of a file, by its name; None for the files that aren't documents
    fn of_file(file_name: &str) -> Option<Self> {
        match extension_of(file_name) {
            Some(ext) => Self::from_extension(&ext),
            None => TEXT_NAMES.contains(&file_name.to_ascii_lowercase().as_str()).then_some(Format::Txt),
        }
    }

    pub fn parse(name: &str) -> Self {
        Self::from_extension(name).unwrap_or(Format::Html)
    }

    fn extension(self) -> &'static str {
        match self {
            Format::Html => "html",
            Format::Md => "md",
            Format::Txt => "txt",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct DocumentExtra {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(default, skip_serializing_if = "is_empty_meta")]
    meta: Value,
    /// a file of another kind opened as text (adopt_file): a document from then on
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    text: bool,
}

fn is_empty_meta(meta: &Value) -> bool {
    meta.is_null() || meta.as_object().is_some_and(|m| m.is_empty())
}

/// .writejs/notebook.json
#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
struct Sidecar {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    colors: BTreeMap<String, String>,
    /// by the document's path in the notebook, e.g. "Work/plan.md"
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    documents: BTreeMap<String, DocumentExtra>,
}

#[derive(Clone, Debug)]
struct Doc {
    /// the path in the notebook, "/"-separated: "Work/plan.md"
    rel: String,
    format: Format,
}

/// what is on the disk, to tell whether something changed there: the files and folders the notebook shows
#[derive(Debug, Default, PartialEq)]
struct Snapshot {
    files: BTreeMap<String, (Option<SystemTime>, u64)>,
    dirs: BTreeSet<String>,
}

#[derive(Default)]
struct State {
    docs: BTreeMap<String, Doc>,
    /// the files that aren't documents, by their path in the notebook
    files: Vec<String>,
    folders: Vec<String>,
    /// document name -> folder, as the page placed them
    placement: BTreeMap<String, String>,
    sidecar: Sidecar,
    snapshot: Snapshot,
    /// what is in folders deeper than MAX_FOLDER_DEPTH, left out
    skipped: usize,
    /// loaded with the scan, handed to the page on its next load
    contents: BTreeMap<String, String>,
}

pub struct Notebook {
    pub entry: Mutex<LocalNotebookEntry>,
    root: PathBuf,
    state: Mutex<State>,
    /// {"origin": client id or "disk"} for every change, to the page's event stream
    pub events: broadcast::Sender<String>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

/// a document name as a file name, on every system
pub fn file_stem_for(name: &str) -> String {
    let mut stem: String = name
        .chars()
        .map(|c| if c.is_control() || r#"/\:*?"<>|"#.contains(c) { '_' } else { c })
        .collect();
    stem = stem.trim().trim_end_matches('.').trim_start_matches('.').to_string();
    if stem.chars().count() > 180 {
        stem = stem.chars().take(180).collect();
    }
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3"];
    if stem.is_empty() {
        stem = "Untitled".into();
    } else if reserved.contains(&stem.to_ascii_uppercase().as_str()) {
        stem = format!("_{stem}");
    }
    stem
}

/// a folder of the page ("Work/Daily") as the folder's path in the notebook
fn folder_dir(folder: &str) -> String {
    folder.split('/').filter(|c| !c.is_empty()).map(file_stem_for).collect::<Vec<_>>().join("/")
}

fn valid_folder(folder: &str) -> bool {
    let parts: Vec<_> = folder.split('/').collect();
    parts.len() <= MAX_FOLDER_DEPTH && parts.iter().all(|p| !p.trim().is_empty() && *p != "." && *p != "..")
}

fn parent_rel(rel: &str) -> &str {
    rel.rfind('/').map(|i| &rel[..i]).unwrap_or("")
}

fn join_rel(dir: &str, name: &str) -> String {
    if dir.is_empty() { name.to_string() } else { format!("{dir}/{name}") }
}

/// what is under a renamed folder moves along with it
fn moved_rel(rel: &str, from: &str, to: &str) -> Option<String> {
    if rel == from {
        Some(to.to_string())
    } else {
        rel.strip_prefix(&format!("{from}/")).map(|rest| format!("{to}/{rest}"))
    }
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn file_name_of(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

fn is_under(rel: &str, dir: &str) -> bool {
    rel == dir || rel.starts_with(&format!("{dir}/"))
}

/// a document's name from its file: "plan.md" -> "plan", "data.csv" -> "data.csv"
fn document_name_of(file_name: &str) -> String {
    match extension_of(file_name) {
        Some(ext) if PLAIN_NAMED.contains(&ext.as_str()) => {
            Path::new(file_name).file_stem().and_then(|s| s.to_str()).unwrap_or(file_name).to_string()
        }
        _ => file_name.to_string(),
    }
}

/// the file of a new document: (stem, extension). A name with the extension of its format keeps it: "data.csv"
fn new_file_parts(name: &str, format: Format) -> (String, String) {
    let file = file_stem_for(name);
    if Format::of_file(&file) == Some(format) {
        if let (Some(stem), Some(ext)) = (Path::new(&file).file_stem().and_then(|s| s.to_str()), Path::new(&file).extension().and_then(|e| e.to_str())) {
            return (stem.to_string(), ext.to_string());
        }
    }
    (file, format.extension().to_string())
}

impl Notebook {
    fn abs(&self, rel: &str) -> PathBuf {
        rel.split('/').filter(|c| !c.is_empty()).fold(self.root.clone(), |p, c| p.join(c))
    }

    fn sidecar_path(&self) -> PathBuf {
        self.root.join(SIDECAR_DIR).join(SIDECAR_FILE)
    }

    /// the folder's entries the notebook shows, in a stable order: (path in the notebook, is a folder)
    fn walk(&self, rel: &str, depth: usize, out: &mut Vec<(String, bool, fs::Metadata)>, skipped: &mut usize) {
        let Ok(read) = fs::read_dir(self.abs(rel)) else { return };
        let mut entries: Vec<_> = read.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let Some(name) = entry.file_name().to_str().map(str::to_string) else { continue };
            if is_hidden(&name) {
                continue;
            }
            let Ok(file_type) = entry.file_type() else { continue };
            // linked folders aren't followed (no loops, nothing outside of the notebook), linked files are
            if file_type.is_symlink() && fs::metadata(entry.path()).map(|m| m.is_dir()).unwrap_or(true) {
                continue;
            }
            let Ok(meta) = fs::metadata(entry.path()) else { continue };
            let child = join_rel(rel, &name);
            if meta.is_dir() {
                if depth < MAX_FOLDER_DEPTH {
                    out.push((child.clone(), true, meta));
                    self.walk(&child, depth + 1, out, skipped);
                } else {
                    *skipped += 1;
                }
            } else {
                out.push((child, false, meta));
            }
        }
    }

    fn snapshot(&self) -> Snapshot {
        let mut entries = vec![];
        self.walk("", 0, &mut entries, &mut 0);
        let mut snapshot = Snapshot::default();
        for (rel, is_dir, meta) in entries {
            if is_dir {
                snapshot.dirs.insert(rel);
            } else {
                snapshot.files.insert(rel, (meta.modified().ok(), meta.len()));
            }
        }
        snapshot
    }

    /// reads the whole notebook from the disk
    fn scan(&self) -> State {
        let mut state = State::default();
        let mut entries = vec![];
        self.walk("", 0, &mut entries, &mut state.skipped);
        state.sidecar = fs::read_to_string(self.sidecar_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        // a name taken twice: the document nearer the notebook's folder keeps it
        entries.sort_by_key(|(rel, is_dir, _)| (!is_dir, rel.matches('/').count(), rel.clone()));
        for (rel, is_dir, meta) in entries {
            if is_dir {
                state.snapshot.dirs.insert(rel.clone());
                state.folders.push(rel);
                continue;
            }
            state.snapshot.files.insert(rel.clone(), (meta.modified().ok(), meta.len()));
            let adopted = state.sidecar.documents.get(&rel).is_some_and(|e| e.text);
            let format = Format::of_file(file_name_of(&rel)).or(adopted.then_some(Format::Txt));
            // too big or not UTF-8 text: listed with the other files
            let content = format.filter(|_| meta.len() <= MAX_FILE_SIZE).and_then(|_| fs::read_to_string(self.abs(&rel)).ok());
            let (Some(format), Some(content)) = (format, content) else {
                state.files.push(rel);
                continue;
            };
            let stem = document_name_of(file_name_of(&rel));
            let mut name = stem.clone();
            for i in 2.. {
                if !state.docs.contains_key(&name) {
                    break;
                }
                name = format!("{stem} ({i})");
            }
            let folder = parent_rel(&rel).to_string();
            if !folder.is_empty() {
                state.placement.insert(name.clone(), folder);
            }
            state.contents.insert(name.clone(), content);
            state.docs.insert(name, Doc { rel, format });
        }
        state
    }

    fn save_sidecar(&self, state: &State) -> Result<()> {
        let path = self.sidecar_path();
        if state.sidecar == Sidecar::default() && !path.exists() {
            return Ok(());
        }
        fs::create_dir_all(path.parent().unwrap())?;
        write_atomic(&path, serde_json::to_string_pretty(&state.sidecar)?.as_bytes())?;
        Ok(())
    }

    /// "name.ext" in the folder, or "name (2).ext"... when that one is taken
    fn free_file(&self, dir: &str, stem: &str, ext: &str) -> String {
        let mut rel = join_rel(dir, &format!("{stem}.{ext}"));
        for i in 2.. {
            if !self.abs(&rel).exists() {
                break;
            }
            rel = join_rel(dir, &format!("{stem} ({i}).{ext}"));
        }
        rel
    }

    fn changed(&self, origin: &str) {
        let _ = self.events.send(json!({ "origin": origin }).to_string());
    }

    /// the notebook for the page: read from the disk anew
    pub fn data(&self) -> Value {
        let mut state = self.state.lock().unwrap();
        let mut scanned = self.scan();
        let contents = std::mem::take(&mut scanned.contents);
        *state = scanned;
        let entry = self.entry.lock().unwrap().clone();
        let documents: Vec<Value> = state
            .docs
            .iter()
            .map(|(name, doc)| {
                let extra = state.sidecar.documents.get(&doc.rel).cloned().unwrap_or_default();
                json!({
                    "name": name,
                    "path": doc.rel,
                    "format": doc.format,
                    "content": contents.get(name).cloned().unwrap_or_default(),
                    "id": extra.id,
                    "meta": if is_empty_meta(&extra.meta) { json!({}) } else { extra.meta },
                })
            })
            .collect();
        json!({
            "id": entry.id,
            "name": entry.name,
            "path": self.root,
            "newFormat": entry.new_format,
            "documents": documents,
            "folders": {
                "folders": state.folders,
                "documents": state.placement,
                "colors": state.sidecar.colors,
            },
            "files": state.files.iter().map(|rel| json!({ "name": file_name_of(rel), "path": rel, "folder": parent_rel(rel) })).collect::<Vec<_>>(),
            "textExtensions": TEXT_EXTENSIONS,
            "skipped": state.skipped,
        })
    }

    /// a document saved by the page; a new one is written into its folder, in the notebook's format for new documents
    pub fn write_document(&self, req: WriteDocument, origin: &str) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        let doc = match state.docs.get(&req.name) {
            Some(doc) => doc.clone(),
            None => {
                let format = req.format.as_deref().map(Format::parse).unwrap_or(Format::Html);
                let folder = state.placement.get(&req.name).filter(|f| state.folders.contains(f)).cloned().unwrap_or_default();
                let dir = folder_dir(&folder);
                fs::create_dir_all(self.abs(&dir))?;
                let (stem, ext) = new_file_parts(&req.name, format);
                Doc { rel: self.free_file(&dir, &stem, &ext), format }
            }
        };
        write_atomic(&self.abs(&doc.rel), req.content.as_bytes())?;
        if doc.format != Format::Html {
            // the ids and metadata the Markdown / text can't hold
            let text = state.sidecar.documents.get(&doc.rel).is_some_and(|e| e.text);
            let extra = DocumentExtra { id: req.id, meta: req.meta, text };
            if state.sidecar.documents.get(&doc.rel) != Some(&extra) {
                state.sidecar.documents.insert(doc.rel.clone(), extra);
                self.save_sidecar(&state)?;
            }
        }
        state.docs.insert(req.name, doc);
        state.snapshot = self.snapshot();
        drop(state);
        self.changed(origin);
        Ok(())
    }

    /// a deleted document goes to the trash; a document the notebook doesn't hold is fine
    pub fn delete_document(&self, name: &str, origin: &str) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        let Some(doc) = state.docs.get(name).cloned() else { return Ok(()) };
        let path = self.abs(&doc.rel);
        if path.exists() {
            trash::delete(&path).map_err(|e| NotebookError(500, format!("Could not move '{}' to the trash: {e}", doc.rel)))?;
        }
        state.docs.remove(name);
        state.placement.remove(name);
        if state.sidecar.documents.remove(&doc.rel).is_some() {
            self.save_sidecar(&state)?;
        }
        state.snapshot = self.snapshot();
        drop(state);
        self.changed(origin);
        Ok(())
    }

    /// the page's folders (foldersKey): new ones are made, documents placed in another folder are moved there,
    /// folders that are gone are removed when nothing is left in them (other files stay where they are)
    pub fn write_folders(&self, store: FolderStore, origin: &str) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        let folders: Vec<String> = store.folders.into_iter().filter(|f| valid_folder(f)).collect();
        for folder in &folders {
            fs::create_dir_all(self.abs(&folder_dir(folder)))?;
        }
        let names: Vec<String> = state.docs.keys().cloned().collect();
        for name in names {
            let doc = state.docs[&name].clone();
            let wanted = store.documents.get(&name).filter(|f| folders.contains(f)).map(|f| folder_dir(f)).unwrap_or_default();
            if parent_rel(&doc.rel) == wanted {
                continue;
            }
            let file = Path::new(&doc.rel);
            let stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or("Untitled");
            let ext = file.extension().and_then(|s| s.to_str()).unwrap_or(doc.format.extension());
            let rel = self.free_file(&wanted, stem, ext);
            fs::rename(self.abs(&doc.rel), self.abs(&rel))?;
            if let Some(extra) = state.sidecar.documents.remove(&doc.rel) {
                state.sidecar.documents.insert(rel.clone(), extra);
            }
            state.docs.insert(name, Doc { rel, format: doc.format });
        }
        // the deepest first, a folder holding only removed folders goes too
        let mut gone: Vec<String> = state.folders.iter().filter(|f| !folders.contains(f)).cloned().collect();
        gone.sort_by_key(|f| std::cmp::Reverse(f.matches('/').count()));
        for folder in gone {
            let _ = fs::remove_dir(self.abs(&folder_dir(&folder)));
        }
        state.folders = folders;
        state.placement = store.documents;
        if state.sidecar.colors != store.colors {
            state.sidecar.colors = store.colors;
        }
        self.save_sidecar(&state)?;
        state.snapshot = self.snapshot();
        drop(state);
        self.changed(origin);
        Ok(())
    }

    /// a folder renamed or moved by the page: the folder on the disk moves, with everything in it
    pub fn rename_folder(&self, from: &str, to: &str, origin: &str) -> Result<()> {
        if !valid_folder(from) || !valid_folder(to) {
            return Err(NotebookError(400, "Invalid folder".into()));
        }
        let mut state = self.state.lock().unwrap();
        let (from_dir, to_dir) = (folder_dir(from), folder_dir(to));
        let (source, target) = (self.abs(&from_dir), self.abs(&to_dir));
        if source.is_dir() && from_dir != to_dir {
            if target.exists() {
                return Err(NotebookError(409, format!("'{to_dir}' already exists in the notebook's folder")));
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::rename(&source, &target)?;
        }
        for doc in state.docs.values_mut() {
            if let Some(rel) = moved_rel(&doc.rel, &from_dir, &to_dir) {
                doc.rel = rel;
            }
        }
        for file in state.files.iter_mut() {
            if let Some(rel) = moved_rel(file, &from_dir, &to_dir) {
                *file = rel;
            }
        }
        state.sidecar.documents = std::mem::take(&mut state.sidecar.documents)
            .into_iter()
            .map(|(rel, extra)| (moved_rel(&rel, &from_dir, &to_dir).unwrap_or(rel), extra))
            .collect();
        state.sidecar.colors = std::mem::take(&mut state.sidecar.colors)
            .into_iter()
            .map(|(f, c)| (moved_rel(&f, from, to).unwrap_or(f), c))
            .collect();
        state.folders = state.folders.iter().map(|f| moved_rel(f, from, to).unwrap_or(f.clone())).collect();
        for folder in state.placement.values_mut() {
            if let Some(f) = moved_rel(folder, from, to) {
                *folder = f;
            }
        }
        self.save_sidecar(&state)?;
        state.snapshot = self.snapshot();
        drop(state);
        self.changed(origin);
        Ok(())
    }

    /// a folder deleted by the page, after its documents: to the trash, with the other files in it
    pub fn delete_folder(&self, folder: &str, origin: &str) -> Result<()> {
        if !valid_folder(folder) {
            return Err(NotebookError(400, "Invalid folder".into()));
        }
        let mut state = self.state.lock().unwrap();
        let dir = folder_dir(folder);
        let path = self.abs(&dir);
        if path.is_dir() {
            trash::delete(&path).map_err(|e| NotebookError(500, format!("Could not move '{dir}' to the trash: {e}")))?;
        }
        state.docs.retain(|_, doc| !is_under(&doc.rel, &dir));
        state.files.retain(|rel| !is_under(rel, &dir));
        state.sidecar.documents.retain(|rel, _| !is_under(rel, &dir));
        state.sidecar.colors.retain(|f, _| !is_under(f, folder));
        state.folders.retain(|f| !is_under(f, folder));
        state.placement.retain(|_, f| !is_under(f, folder));
        self.save_sidecar(&state)?;
        state.snapshot = self.snapshot();
        drop(state);
        self.changed(origin);
        Ok(())
    }

    /// "try to open anyway": a file that isn't a document, as text. UTF-8 text becomes a document of the notebook
    /// (remembered: .writejs/notebook.json), anything else comes back as text to look at, the file stays as it is
    pub fn adopt_file(&self, rel: &str, origin: &str) -> Result<Value> {
        let mut state = self.state.lock().unwrap();
        let Some(index) = state.files.iter().position(|f| f == rel) else {
            return Err(NotebookError(404, format!("'{rel}' is not in the notebook")));
        };
        let path = self.abs(rel);
        if fs::metadata(&path)?.len() > MAX_FILE_SIZE {
            return Err(NotebookError(413, format!("'{}' is too big to open (over 8 MB)", file_name_of(rel))));
        }
        let content = match String::from_utf8(fs::read(&path)?) {
            Ok(content) => content,
            Err(err) => {
                let bytes = err.into_bytes();
                let shown = &bytes[..bytes.len().min(1024 * 1024)];
                return Ok(json!({ "binary": true, "text": String::from_utf8_lossy(shown) }));
            }
        };
        state.files.remove(index);
        let base = file_name_of(rel).to_string();
        let mut name = base.clone();
        for i in 2.. {
            if !state.docs.contains_key(&name) {
                break;
            }
            name = format!("{base} ({i})");
        }
        state.sidecar.documents.entry(rel.to_string()).or_default().text = true;
        self.save_sidecar(&state)?;
        let folder = parent_rel(rel).to_string();
        if !folder.is_empty() {
            state.placement.insert(name.clone(), folder);
        }
        state.docs.insert(name.clone(), Doc { rel: rel.to_string(), format: Format::Txt });
        drop(state);
        self.changed(origin);
        Ok(json!({ "document": { "name": name, "path": rel, "format": Format::Txt, "content": content, "id": null, "meta": {} } }))
    }

    /// a file or a document of the notebook on the disk, to open it with the system's app
    pub fn path_of(&self, rel: &str) -> Result<PathBuf> {
        let state = self.state.lock().unwrap();
        if !state.files.iter().any(|f| f == rel) && !state.docs.values().any(|d| d.rel == rel) {
            return Err(NotebookError(404, format!("'{rel}' is not in the notebook")));
        }
        Ok(self.abs(rel))
    }

    /// after a change on the disk: tells the pages when it changed what the notebook shows
    fn check_disk(&self) {
        let mut state = self.state.lock().unwrap();
        let snapshot = self.snapshot();
        if snapshot == state.snapshot {
            return;
        }
        state.snapshot = snapshot;
        drop(state);
        self.changed("disk");
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
}

#[derive(Deserialize)]
pub struct WriteDocument {
    pub name: String,
    pub format: Option<String>,
    pub content: String,
    pub id: Option<String>,
    #[serde(default)]
    pub meta: Value,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct FolderStore {
    pub folders: Vec<String>,
    pub documents: BTreeMap<String, String>,
    pub colors: BTreeMap<String, String>,
}

/// the opened notebooks, each read and watched once for all the windows
#[derive(Default)]
pub struct LocalNotebooks {
    open: Mutex<HashMap<String, Arc<Notebook>>>,
}

impl LocalNotebooks {
    pub fn get(&self, entry: &LocalNotebookEntry) -> Result<Arc<Notebook>> {
        let mut open = self.open.lock().unwrap();
        if let Some(nb) = open.get(&entry.id) {
            *nb.entry.lock().unwrap() = entry.clone();
            return Ok(nb.clone());
        }
        if !entry.path.is_dir() {
            return Err(NotebookError(404, format!("The folder '{}' is not there anymore", entry.path.display())));
        }
        let (events, _) = broadcast::channel(64);
        let nb = Arc::new(Notebook {
            entry: Mutex::new(entry.clone()),
            root: entry.path.clone(),
            state: Mutex::new(State::default()),
            events,
            watcher: Mutex::new(None),
        });
        *nb.watcher.lock().unwrap() = watch(&nb);
        open.insert(entry.id.clone(), nb.clone());
        Ok(nb)
    }

    /// a notebook taken off the list: no longer watched
    pub fn close(&self, id: &str) {
        self.open.lock().unwrap().remove(id);
    }
}

fn watch(nb: &Arc<Notebook>) -> Option<notify::RecommendedWatcher> {
    let (tx, mut rx) = mpsc::unbounded_channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    })
    .ok()?;
    watcher.watch(&nb.root, RecursiveMode::Recursive).ok()?;
    let weak: Weak<Notebook> = Arc::downgrade(nb);
    tokio::spawn(async move {
        while rx.recv().await.is_some() {
            // settled: no more events for a while
            while let Ok(Some(())) = tokio::time::timeout(WATCH_SETTLE, rx.recv()).await {}
            let Some(nb) = weak.upgrade() else { break };
            let _ = tokio::task::spawn_blocking(move || nb.check_disk()).await;
        }
    });
    Some(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notebook(dir: &Path) -> Arc<Notebook> {
        let entry = LocalNotebookEntry { id: "t".into(), name: "t".into(), path: dir.into(), new_format: "html".into() };
        let (events, _) = broadcast::channel(8);
        Arc::new(Notebook {
            entry: Mutex::new(entry),
            root: dir.into(),
            state: Mutex::new(State::default()),
            events,
            watcher: Mutex::new(None),
        })
    }

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("writejs-nb-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scans_documents_and_folders() {
        let dir = tmp("scan");
        fs::create_dir_all(dir.join("Work/Daily")).unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::write(dir.join("a.md"), "# A").unwrap();
        fs::write(dir.join("Work/a.html"), "<div>a</div>").unwrap();
        fs::write(dir.join("Work/Daily/b.txt"), "b").unwrap();
        fs::write(dir.join("image.png"), [0u8, 1]).unwrap();
        fs::write(dir.join("Work/data.csv"), "a,b\n1,2\n").unwrap();
        fs::write(dir.join("Work/broken.json"), [0xffu8, 0xfe]).unwrap();
        fs::write(dir.join("Makefile"), "all:\n").unwrap();
        fs::write(dir.join(".hidden.md"), "x").unwrap();
        let data = notebook(&dir).data();
        let names: Vec<_> = data["documents"].as_array().unwrap().iter().map(|d| d["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["Makefile", "a", "a (2)", "b", "data.csv"]);
        // not text: listed as files
        let files: Vec<_> = data["files"].as_array().unwrap().iter().map(|f| f["path"].as_str().unwrap()).collect();
        assert_eq!(files, ["image.png", "Work/broken.json"]);
        assert_eq!(data["folders"]["folders"], json!(["Work", "Work/Daily"]));
        assert_eq!(data["folders"]["documents"], json!({"a (2)": "Work", "b": "Work/Daily", "data.csv": "Work"}));
    }

    #[test]
    fn files_are_opened_as_text() {
        let dir = tmp("adopt");
        fs::write(dir.join("notes.conf2"), "key = value\n").unwrap();
        fs::write(dir.join("photo.png"), [0x89u8, b'P', b'N', b'G', 0xff]).unwrap();
        let nb = notebook(&dir);
        nb.data();
        let adopted = nb.adopt_file("notes.conf2", "c").unwrap();
        assert_eq!(adopted["document"]["name"], "notes.conf2");
        let binary = nb.adopt_file("photo.png", "c").unwrap();
        assert_eq!(binary["binary"], true);
        // remembered as a document, the picture stays a file
        let data = nb.data();
        assert_eq!(data["documents"][0]["name"], "notes.conf2");
        assert_eq!(data["files"], json!([{"name": "photo.png", "path": "photo.png", "folder": ""}]));
        // a new document named with a text extension keeps it
        let doc = |name: &str| WriteDocument { name: name.into(), format: Some("txt".into()), content: "x".into(), id: None, meta: json!({}) };
        nb.write_document(doc("todo.yaml"), "c").unwrap();
        assert!(dir.join("todo.yaml").is_file());
        nb.write_document(doc("plain"), "c").unwrap();
        assert!(dir.join("plain.txt").is_file());
    }

    #[test]
    fn writes_moves_renames_and_deletes() {
        let dir = tmp("write");
        let nb = notebook(&dir);
        nb.data();
        let write = |name: &str, format: &str| WriteDocument {
            name: name.into(),
            format: Some(format.into()),
            content: "x".into(),
            id: Some("id-1".into()),
            meta: json!({}),
        };
        nb.write_document(write("Plan: Q1", "md"), "c").unwrap();
        assert!(dir.join("Plan_ Q1.md").is_file());
        let store = |folders: &[&str], docs: &[(&str, &str)]| FolderStore {
            folders: folders.iter().map(|s| s.to_string()).collect(),
            documents: docs.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect(),
            colors: BTreeMap::new(),
        };
        nb.write_folders(store(&["Work"], &[("Plan: Q1", "Work")]), "c").unwrap();
        assert!(dir.join("Work/Plan_ Q1.md").is_file());
        // the id of a Markdown document moved along
        let sidecar: Value = serde_json::from_str(&fs::read_to_string(dir.join(".writejs/notebook.json")).unwrap()).unwrap();
        assert_eq!(sidecar["documents"]["Work/Plan_ Q1.md"]["id"], "id-1");
        fs::write(dir.join("Work/photo.png"), [0u8]).unwrap();
        nb.rename_folder("Work", "Jobs", "c").unwrap();
        assert!(dir.join("Jobs/Plan_ Q1.md").is_file() && dir.join("Jobs/photo.png").is_file());
        nb.write_folders(store(&["Jobs"], &[("Plan: Q1", "Jobs")]), "c").unwrap();
        nb.write_folders(store(&[], &[]), "c").unwrap();
        assert!(dir.join("Plan_ Q1.md").is_file());
        // the folder still holds the picture: it stays
        assert!(dir.join("Jobs/photo.png").is_file());
        nb.write_document(write("New", "html"), "c").unwrap();
        assert_eq!(fs::read_to_string(dir.join("New.html")).unwrap(), "x");
    }
}
