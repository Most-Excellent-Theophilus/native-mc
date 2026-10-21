//! Decides which files must never be backed up: editor/Office scratch files,
//! lock files, partial downloads and OS metadata.
//!
//! Names are compared case-insensitively. Directories listed in
//! `is_ignored_dir` are skipped entirely (the walker never descends into them).

/// Exact file names (lower-case) that are OS or app metadata.
const JUNK_NAMES: &[&str] = &[
    ".ds_store",
    ".localized",
    "thumbs.db",
    "ehthumbs.db",
    "desktop.ini",
    ".apdisk",
    ".directory",
];

/// Prefixes of temporary files.
const TEMP_PREFIXES: &[&str] = &[
    "~$",       // Word / Excel / PowerPoint owner (lock) file: ~$report.docx
    "~wr",      // Word scratch: ~WRL0001.tmp, ~WRD0000.tmp
    "~wrf",     // Word scratch
    ".~lock.",  // LibreOffice / OpenOffice lock: .~lock.report.odt#
    ".~",       // other dot-tilde scratch
    ".#",       // Emacs lock
    ".tmp.",    // Google Drive: .tmp.driveupload
];

/// Suffixes of temporary or partial files.
const TEMP_SUFFIXES: &[&str] = &[
    ".tmp",         // Office saves, installers, almost everything
    ".temp",
    "~",            // editor backup copies: notes.txt~
    ".swp",         // vim
    ".swo",
    ".swx",
    ".crdownload",  // Chrome / Edge partial download
    ".part",        // Firefox / wget partial download
    ".partial",
    ".download",    // Safari partial download
    ".opdownload",  // Opera partial download
    ".wbk",         // Word backup
    ".asd",         // Word AutoRecover
    ".laccdb",      // Access lock
    ".ldb",         // Access lock
];

/// Directory names (lower-case) that are never backed up.
const IGNORED_DIRS: &[&str] = &[
    "$recycle.bin",
    "system volume information",
    ".trashes",
    ".spotlight-v100",
    ".fseventsd",
    ".temporaryitems",
    ".tmp.driveupload",
    ".tmp.drivedownload",
];

/// True when `name` (a file name, not a path) is a temporary or junk file.
pub fn is_temp_name(name: &str) -> bool {
    let n = name.to_lowercase();

    if JUNK_NAMES.contains(&n.as_str()) {
        return true;
    }
    if TEMP_PREFIXES.iter().any(|p| n.starts_with(p)) {
        return true;
    }
    if TEMP_SUFFIXES.iter().any(|s| n.ends_with(s)) {
        return true;
    }
    // Excel writes its in-progress save to a file named with 8 hex digits and
    // no extension (e.g. "A1B2C3D0"), then renames it over the original.
    if n.len() == 8 && n.chars().all(|c| c.is_ascii_hexdigit()) {
        return true;
    }
    false
}

/// True when the directory `name` should be skipped together with its contents.
pub fn is_ignored_dir(name: &str) -> bool {
    let n = name.to_lowercase();
    IGNORED_DIRS.contains(&n.as_str()) || n.starts_with(".trash")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn office_temp_files_are_skipped() {
        for name in [
            "~$report.docx",
            "~$Budget.xlsx",
            "~$deck.pptx",
            "~WRL0001.tmp",
            "~WRD0000.tmp",
            "ppt1A2B.tmp",
            "A1B2C3D0",
            "AutoRecovery save of Book1.asd",
            "Backup of report.wbk",
            ".~lock.notes.odt#",
        ] {
            assert!(is_temp_name(name), "{name} should be skipped");
        }
    }

    #[test]
    fn partial_downloads_and_editor_files_are_skipped() {
        for name in [
            "movie.mp4.crdownload",
            "iso.part",
            "file.download",
            "notes.txt~",
            ".notes.txt.swp",
            ".#main.rs",
            "Thumbs.db",
            ".DS_Store",
            "desktop.ini",
            "x.TMP",
        ] {
            assert!(is_temp_name(name), "{name} should be skipped");
        }
    }

    #[test]
    fn real_documents_are_kept() {
        for name in [
            "report.docx",
            "Budget 2026.xlsx",
            "deck.pptx",
            "photo.jpg",
            "archive.zip",
            "README",
            "notes.txt",
            "12345678.txt", // has an extension, so not an Excel scratch file
            "tmp-report.pdf",
        ] {
            assert!(!is_temp_name(name), "{name} should be kept");
        }
    }

    #[test]
    fn junk_directories() {
        assert!(is_ignored_dir("$RECYCLE.BIN"));
        assert!(is_ignored_dir("System Volume Information"));
        assert!(is_ignored_dir(".Trash-1000"));
        assert!(!is_ignored_dir("Documents"));
    }
}
