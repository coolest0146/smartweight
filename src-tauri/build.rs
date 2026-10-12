use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    if cfg!(target_os = "windows") {
        let opencv_link_paths = env::var("OPENCV_LINK_PATHS")
            .unwrap_or_else(|_| r"C:\Program Files\opencv\build\x64\vc16\lib".to_string());
        let opencv_bin_dir = PathBuf::from(&opencv_link_paths)
            .parent()
            .map(|p| p.join("bin"))
            .unwrap_or_else(|| PathBuf::from(r"C:\Program Files\opencv\build\x64\vc16\bin"));

        let dlls = [
            "opencv_world4140.dll",
            "opencv_videoio_ffmpeg4140_64.dll",
        ];

        let src_tauri_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string()));
        let runtime_dir = src_tauri_dir.join("bin");
        let _ = fs::create_dir_all(&runtime_dir);

        for dll in dlls {
            let source = opencv_bin_dir.join(dll);
            let destination = runtime_dir.join(dll);

            if source.exists() {
                if let Err(err) = fs::copy(&source, &destination) {
                    eprintln!("Failed to copy {} to {}: {}", dll, destination.display(), err);
                }
            } else {
                eprintln!("OpenCV runtime DLL not found: {}", source.display());
            }
        }
    }

    tauri_build::build();
}
