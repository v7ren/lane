fn main() {
    let dist = std::path::Path::new("..").join("dist");

    if !dist.join("index.html").is_file() {
        let _ = std::fs::create_dir_all(&dist);
        let _ = std::fs::write(
            dist.join("index.html"),
            "<!doctype html><html><head><title>Loomria</title></head><body></body></html>",
        );
    }

    #[cfg(target_os = "windows")]
    {
        let manifest = std::path::Path::new("windows-common-controls.manifest")
            .canonicalize()
            .expect("windows-common-controls.manifest");
        let manifest = manifest.to_string_lossy();
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTINPUT:{manifest}");
    }

    let windows = tauri_build::WindowsAttributes::new_without_app_manifest().app_manifest(
        include_str!("windows-common-controls.manifest"),
    );
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri build");
}
