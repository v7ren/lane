fn main() {
    let dist = std::path::Path::new("..").join("dist");
    if !dist.join("index.html").is_file() {
        let _ = std::fs::create_dir_all(&dist);
        let _ = std::fs::write(
            dist.join("index.html"),
            "<!doctype html><html><head><title>Loomria</title></head><body></body></html>",
        );
    }
    tauri_build::build();
}
