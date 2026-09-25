use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use chrono::{DateTime, Utc};

use crate::library::is_video_extension;

const QUICKTIME_EPOCH_OFFSET: i64 = 2_082_844_800;
const CREATION_DATE_KEY: &[u8] = b"com.apple.quicktime.creationdate";

struct Atom {
    kind: [u8; 4],
    start: u64,
    end: u64,
}

fn atom(file: &mut File, parent_end: u64) -> Option<Atom> {
    let start = file.stream_position().ok()?;
    if parent_end.checked_sub(start)? < 8 {
        return None;
    }
    let mut header = [0; 8];
    file.read_exact(&mut header).ok()?;
    let mut size = u32::from_be_bytes(header[..4].try_into().ok()?) as u64;
    let mut header_size = 8;
    if size == 1 {
        size = read_u64(file)?;
        header_size = 16;
    } else if size == 0 {
        size = parent_end - start;
    }
    let end = start.checked_add(size)?;
    if size < header_size || end > parent_end {
        return None;
    }
    Some(Atom {
        kind: header[4..8].try_into().ok()?,
        start: start + header_size,
        end,
    })
}

fn read_u32(file: &mut File) -> Option<u32> {
    let mut bytes = [0; 4];
    file.read_exact(&mut bytes).ok()?;
    Some(u32::from_be_bytes(bytes))
}

fn read_u64(file: &mut File) -> Option<u64> {
    let mut bytes = [0; 8];
    file.read_exact(&mut bytes).ok()?;
    Some(u64::from_be_bytes(bytes))
}

fn movie_header_date(file: &mut File, end: u64) -> Option<String> {
    let version = read_u32(file)? >> 24;
    let seconds = match version {
        0 if end.checked_sub(file.stream_position().ok()?)? >= 4 => read_u32(file)? as u64,
        1 if end.checked_sub(file.stream_position().ok()?)? >= 8 => read_u64(file)?,
        _ => return None,
    };
    if seconds == 0 {
        return None;
    }
    let unix_seconds = i64::try_from(seconds)
        .ok()?
        .checked_sub(QUICKTIME_EPOCH_OFFSET)?;
    let date = DateTime::<Utc>::from_timestamp(unix_seconds, 0)?;
    Some(date.format("%Y-%m-%d %H:%M:%S").to_string())
}

fn metadata_key_index(file: &mut File, end: u64) -> Option<u32> {
    if end.checked_sub(file.stream_position().ok()?)? < 8 {
        return None;
    }
    let _version_flags = read_u32(file)?;
    let count = read_u32(file)?.min(4096);
    for index in 1..=count {
        let size = read_u32(file)? as u64;
        let mut namespace = [0; 4];
        file.read_exact(&mut namespace).ok()?;
        let length = size.checked_sub(8)?;
        if length > 1024 || file.stream_position().ok()?.checked_add(length)? > end {
            return None;
        }
        let mut key = vec![0; length as usize];
        file.read_exact(&mut key).ok()?;
        if namespace == *b"mdta" && key == CREATION_DATE_KEY {
            return Some(index);
        }
    }
    None
}

fn metadata_date(file: &mut File, end: u64) -> Option<String> {
    if end.checked_sub(file.stream_position().ok()?)? < 4 {
        return None;
    }
    let _version_flags = read_u32(file)?;
    let mut key_index = None;
    let mut list = None;
    while let Some(entry) = atom(file, end) {
        if entry.kind == *b"keys" {
            key_index = metadata_key_index(file, entry.end);
        } else if entry.kind == *b"ilst" {
            list = Some((entry.start, entry.end));
        }
        file.seek(SeekFrom::Start(entry.end)).ok()?;
    }
    let (start, end) = list?;
    let key_index = key_index?.to_be_bytes();
    file.seek(SeekFrom::Start(start)).ok()?;
    while let Some(entry) = atom(file, end) {
        if entry.kind == key_index {
            while let Some(data) = atom(file, entry.end) {
                if data.kind == *b"data" && data.end.checked_sub(data.start)? >= 8 {
                    let data_type = read_u32(file)? & 0xff;
                    let _locale = read_u32(file)?;
                    let length = data.end.checked_sub(file.stream_position().ok()?)?;
                    if data_type == 1 && length <= 128 {
                        let mut bytes = vec![0; length as usize];
                        file.read_exact(&mut bytes).ok()?;
                        let value = std::str::from_utf8(&bytes).ok()?.trim_end_matches('\0');
                        let date = DateTime::parse_from_rfc3339(value).ok()?;
                        return Some(date.format("%Y-%m-%d %H:%M:%S").to_string());
                    }
                }
                file.seek(SeekFrom::Start(data.end)).ok()?;
            }
        }
        file.seek(SeekFrom::Start(entry.end)).ok()?;
    }
    None
}

fn nested_metadata(file: &mut File, start: u64, end: u64) -> Option<String> {
    file.seek(SeekFrom::Start(start)).ok()?;
    while let Some(entry) = atom(file, end) {
        if entry.kind == *b"meta" {
            if let Some(date) = metadata_date(file, entry.end) {
                return Some(date);
            }
        }
        file.seek(SeekFrom::Start(entry.end)).ok()?;
    }
    None
}

pub fn capture_date(path: &Path) -> Option<String> {
    if !path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(is_video_extension)
    {
        return None;
    }
    let mut file = File::open(path).ok()?;
    let end = file.metadata().ok()?.len();
    let mut fallback = None;
    while let Some(entry) = atom(&mut file, end) {
        if entry.kind == *b"moov" {
            file.seek(SeekFrom::Start(entry.start)).ok()?;
            while let Some(child) = atom(&mut file, entry.end) {
                if child.kind == *b"mvhd" {
                    fallback = movie_header_date(&mut file, child.end).or(fallback);
                } else if matches!(&child.kind, b"udta" | b"meta") {
                    let date = if child.kind == *b"meta" {
                        metadata_date(&mut file, child.end)
                    } else {
                        nested_metadata(&mut file, child.start, child.end)
                    };
                    if date.is_some() {
                        return date;
                    }
                }
                file.seek(SeekFrom::Start(child.end)).ok()?;
            }
        }
        file.seek(SeekFrom::Start(entry.end)).ok()?;
    }
    fallback
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn box_bytes(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut bytes = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        bytes.extend(kind);
        bytes.extend(payload);
        bytes
    }

    #[test]
    fn reads_movie_header_and_prefers_capture_date_with_offset() {
        let mut header = vec![0; 4];
        header.extend((2_082_844_800u32 + 86_400).to_be_bytes());
        let header = box_bytes(b"mvhd", &header);
        let mut keys = vec![0; 4];
        keys.extend(1u32.to_be_bytes());
        keys.extend(box_bytes(b"mdta", CREATION_DATE_KEY));
        let mut data = vec![0, 0, 0, 1, 0, 0, 0, 0];
        data.extend(b"2024-08-10T17:23:45+02:00");
        let list = box_bytes(&1u32.to_be_bytes(), &box_bytes(b"data", &data));
        let mut meta = vec![0; 4];
        meta.extend(box_bytes(b"keys", &keys));
        meta.extend(box_bytes(b"ilst", &list));
        let mut movie = header.clone();
        movie.extend(box_bytes(b"udta", &box_bytes(b"meta", &meta)));
        let path =
            std::env::temp_dir().join(format!("warble-video-date-{}.MOV", std::process::id()));
        fs::write(&path, box_bytes(b"moov", &movie)).unwrap();
        assert_eq!(capture_date(&path).as_deref(), Some("2024-08-10 17:23:45"));
        fs::write(&path, box_bytes(b"moov", &header)).unwrap();
        assert_eq!(capture_date(&path).as_deref(), Some("1970-01-02 00:00:00"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn skips_media_data_and_reads_version_one_movie_header() {
        let mut header = vec![1, 0, 0, 0];
        header.extend((2_082_844_800u64 + 86_400).to_be_bytes());
        let movie = box_bytes(b"moov", &box_bytes(b"mvhd", &header));
        let mut bytes = box_bytes(b"mdat", &[0; 64]);
        bytes.extend(movie);
        let path =
            std::env::temp_dir().join(format!("warble-video-date-v1-{}.mp4", std::process::id()));
        fs::write(&path, bytes).unwrap();
        assert_eq!(capture_date(&path).as_deref(), Some("1970-01-02 00:00:00"));
        fs::write(&path, box_bytes(b"moov", &box_bytes(b"mvhd", &[0; 4]))).unwrap();
        assert_eq!(capture_date(&path), None);
        fs::remove_file(path).unwrap();
    }
}
