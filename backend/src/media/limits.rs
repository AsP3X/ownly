// Human: Reject decompression-bomb dimensions before image/GIF/WebP decode or canvas compositing.
// Agent: READS headers via image crate or caller-supplied canvas size; ERR on excessive pixels (SEC-021).

use std::io::Cursor;

use image::ImageReader;

/// Human: Max width or height for still raster thumbnails — blocks huge declared dimensions.
pub const MAX_IMAGE_DIMENSION: u32 = 16_384;

/// Human: Max pixel count (width × height) accepted before full decode.
pub const MAX_IMAGE_PIXEL_COUNT: u64 = 50_000_000;

/// Human: Max canvas edge for animated GIF/WebP preview transcodes.
pub const MAX_ANIMATED_CANVAS_DIMENSION: u32 = 4096;

/// Human: Max pixel area for animated preview canvases.
pub const MAX_ANIMATED_CANVAS_PIXEL_COUNT: u64 = 16_777_216; // 4096 × 4096

// Human: Validate width/height bounds shared by raster thumbnails and animated previews.
// Agent: PURE; RETURNS Err string when either edge or pixel product exceeds limits.
pub fn validate_image_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("image dimensions must be positive".into());
    }
    if width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION {
        return Err(format!(
            "image dimensions {width}x{height} exceed max edge {MAX_IMAGE_DIMENSION}"
        ));
    }
    let pixels = u64::from(width) * u64::from(height);
    if pixels > MAX_IMAGE_PIXEL_COUNT {
        return Err(format!(
            "image pixel count {pixels} exceeds limit {MAX_IMAGE_PIXEL_COUNT}"
        ));
    }
    Ok(())
}

// Human: Stricter canvas guard for GIF/WebP MP4 preview generation.
// Agent: CALLED after logical-screen or webpmux canvas probe; REJECTS before frame compositing.
pub fn validate_animated_canvas_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("animated canvas dimensions must be positive".into());
    }
    if width > MAX_ANIMATED_CANVAS_DIMENSION || height > MAX_ANIMATED_CANVAS_DIMENSION {
        return Err(format!(
            "animated canvas {width}x{height} exceeds max edge {MAX_ANIMATED_CANVAS_DIMENSION}"
        ));
    }
    let pixels = u64::from(width) * u64::from(height);
    if pixels > MAX_ANIMATED_CANVAS_PIXEL_COUNT {
        return Err(format!(
            "animated canvas pixel count {pixels} exceeds limit {MAX_ANIMATED_CANVAS_PIXEL_COUNT}"
        ));
    }
    Ok(())
}

// Human: Read raster dimensions from file headers without allocating the full decode buffer.
// Agent: USES ImageReader::into_dimensions; VALIDATES against validate_image_dimensions.
pub fn probe_raster_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("image format guess failed: {e}"))?;

    let (width, height) = reader
        .into_dimensions()
        .map_err(|e| format!("image dimensions probe failed: {e}"))?;

    validate_image_dimensions(width, height)?;
    Ok((width, height))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    #[test]
    fn validate_image_dimensions_rejects_oversized_edge() {
        assert!(validate_image_dimensions(16_385, 100).is_err());
        assert!(validate_image_dimensions(100, 16_385).is_err());
        assert!(validate_image_dimensions(640, 480).is_ok());
    }

    #[test]
    fn validate_image_dimensions_rejects_excessive_pixels() {
        assert!(validate_image_dimensions(10_000, 10_000).is_err());
    }

    #[test]
    fn validate_animated_canvas_dimensions_caps_preview_canvas() {
        assert!(validate_animated_canvas_dimensions(4096, 4096).is_ok());
        assert!(validate_animated_canvas_dimensions(5000, 100).is_err());
    }

    #[test]
    fn probe_raster_dimensions_reads_png_header() {
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> =
            ImageBuffer::from_fn(64, 48, |_, _| Rgb([128, 64, 32]));
        let mut png = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("png encode");
        let (width, height) = probe_raster_dimensions(&png).expect("probe");
        assert_eq!((width, height), (64, 48));
    }
}
