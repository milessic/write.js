use std::{fs, path::Path};

/// A constant of the web server (e.g. the themes version) read from its Python source, so the app doesn't drift from it.
fn python_constant(file: &str, name: &str) -> String {
    let path = Path::new("../..").join(file);
    println!("cargo:rerun-if-changed={}", path.display());
    let source = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let pattern = regex::Regex::new(&format!(r#"(?m)^{name}\s*=\s*"([^"]*)""#)).unwrap();
    pattern
        .captures(&source)
        .unwrap_or_else(|| panic!("{name} not found in {file}"))[1]
        .to_string()
}

fn main() {
    println!("cargo:rustc-env=WRITEJS_THEMES_VERSION={}", python_constant("utils/themes.py", "THEMES_VERSION"));
    println!("cargo:rustc-env=WRITEJS_LEGAL_UPDATED={}", python_constant("routers/web.py", "LEGAL_UPDATED"));
    tauri_build::build()
}
