//! Decode HEIC/HEIF with Apple's ImageIO on macOS and iOS.

use std::ffi::{c_char, c_void};
use std::path::Path;

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFURLCreateFromFileSystemRepresentation(
        allocator: *const c_void,
        bytes: *const u8,
        length: isize,
        is_directory: bool,
    ) -> *const c_void;
    fn CFDataCreateMutable(allocator: *const c_void, capacity: isize) -> *mut c_void;
    fn CFDataGetLength(data: *const c_void) -> isize;
    fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
    fn CFStringCreateWithCString(
        allocator: *const c_void,
        string: *const c_char,
        encoding: u32,
    ) -> *const c_void;
    fn CFNumberCreate(
        allocator: *const c_void,
        number_type: isize,
        value: *const c_void,
    ) -> *const c_void;
    fn CFDictionaryCreate(
        allocator: *const c_void,
        keys: *const *const c_void,
        values: *const *const c_void,
        count: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> *const c_void;
    static kCFBooleanTrue: *const c_void;
    fn CFRelease(value: *const c_void);
}

#[link(name = "ImageIO", kind = "framework")]
extern "C" {
    fn CGImageSourceCreateWithURL(url: *const c_void, options: *const c_void) -> *const c_void;
    fn CGImageSourceCreateThumbnailAtIndex(
        source: *const c_void,
        index: usize,
        options: *const c_void,
    ) -> *const c_void;
    static kCGImageSourceCreateThumbnailFromImageAlways: *const c_void;
    static kCGImageSourceCreateThumbnailWithTransform: *const c_void;
    static kCGImageSourceThumbnailMaxPixelSize: *const c_void;
    fn CGImageDestinationCreateWithData(
        data: *mut c_void,
        format: *const c_void,
        count: usize,
        options: *const c_void,
    ) -> *const c_void;
    fn CGImageDestinationAddImage(
        destination: *const c_void,
        image: *const c_void,
        properties: *const c_void,
    );
    fn CGImageDestinationFinalize(destination: *const c_void) -> bool;
}

pub fn to_jpeg(path: &Path, max_long_side: u32) -> Result<Vec<u8>, String> {
    use std::os::unix::ffi::OsStrExt;

    let bytes = path.as_os_str().as_bytes();
    // All references returned by the CoreFoundation create functions are owned.
    unsafe {
        let url = CFURLCreateFromFileSystemRepresentation(
            std::ptr::null(),
            bytes.as_ptr(),
            bytes.len() as isize,
            false,
        );
        if url.is_null() {
            return Err("Could not open HEIF file".into());
        }
        let source = CGImageSourceCreateWithURL(url, std::ptr::null());
        CFRelease(url);
        if source.is_null() {
            return Err("ImageIO could not read HEIF file".into());
        }
        let max_size = i32::try_from(max_long_side).unwrap_or(i32::MAX);
        let size = CFNumberCreate(
            std::ptr::null(),
            3,
            &max_size as *const i32 as *const c_void,
        );
        if size.is_null() {
            CFRelease(source);
            return Err("Could not configure HEIF decoder".into());
        }
        let keys = [
            kCGImageSourceCreateThumbnailFromImageAlways,
            kCGImageSourceCreateThumbnailWithTransform,
            kCGImageSourceThumbnailMaxPixelSize,
        ];
        let values = [kCFBooleanTrue, kCFBooleanTrue, size];
        let options = CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            3,
            std::ptr::null(),
            std::ptr::null(),
        );
        let image = if options.is_null() {
            std::ptr::null()
        } else {
            CGImageSourceCreateThumbnailAtIndex(source, 0, options)
        };
        if !options.is_null() {
            CFRelease(options);
        }
        CFRelease(size);
        CFRelease(source);
        if image.is_null() {
            return Err("ImageIO could not decode HEIF image".into());
        }
        let data = CFDataCreateMutable(std::ptr::null(), 0);
        let format =
            CFStringCreateWithCString(std::ptr::null(), c"public.jpeg".as_ptr(), 0x0800_0100);
        if data.is_null() || format.is_null() {
            if !data.is_null() {
                CFRelease(data);
            }
            if !format.is_null() {
                CFRelease(format);
            }
            CFRelease(image);
            return Err("Could not allocate JPEG output".into());
        }
        let destination = CGImageDestinationCreateWithData(data, format, 1, std::ptr::null());
        CFRelease(format);
        let result = if destination.is_null() {
            Err("Could not create JPEG encoder".to_string())
        } else {
            CGImageDestinationAddImage(destination, image, std::ptr::null());
            let success = CGImageDestinationFinalize(destination);
            CFRelease(destination);
            if success {
                let length = CFDataGetLength(data);
                let pointer = CFDataGetBytePtr(data);
                if length > 0 && !pointer.is_null() {
                    Ok(std::slice::from_raw_parts(pointer, length as usize).to_vec())
                } else {
                    Err("HEIF decoder produced an empty JPEG".into())
                }
            } else {
                Err("ImageIO could not encode HEIF preview".into())
            }
        };
        CFRelease(data);
        CFRelease(image);
        result
    }
}
