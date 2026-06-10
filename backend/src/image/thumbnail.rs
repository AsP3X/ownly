// Human: Decode uploaded images and emit a grid-sized JPEG for explorer tiles.
// Agent: USES image crate thumbnail(); RETURNS JPEG bytes for Nebular PUT.

use std::io::Cursor;

use image::codecs::jpeg::JpegEncoder;
use image::DynamicImage;

/// Human: Longest edge for stored grid JPEGs — CSS scales down further in the explorer.
pub const GRID_THUMBNAIL_MAX_EDGE: u32 = 640;

const GRID_THUMBNAIL_JPEG_QUALITY: u8 = 82;

// Human: Resize and re-encode source bytes into a compact JPEG for grid display.
// Agent: CALLED by thumbnail worker; SUPPORTS common raster formats via image crate.
pub fn generate_grid_thumbnail_jpeg(source_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let reader = image::ImageReader::new(Cursor::new(source_bytes))
        .with_guessed_format()
        .map_err(|e| format!("image format guess failed: {e}"))?;

    let decoded = reader
        .decode()
        .map_err(|e| format!("image decode failed: {e}"))?;

    let thumbnail = resize_to_max_edge(decoded, GRID_THUMBNAIL_MAX_EDGE);
    encode_jpeg(&thumbnail, GRID_THUMBNAIL_JPEG_QUALITY)
}

// Human: Preserve aspect ratio while bounding the longest edge to max_edge pixels.
// Agent: USES thumbnail() for fast downscale; RETURNS DynamicImage RGB8.
pub(crate) fn resize_to_max_edge(image: DynamicImage, max_edge: u32) -> DynamicImage {
    let (width, height) = (image.width(), image.height());
    if width <= max_edge && height <= max_edge {
        return image;
    }
    image.thumbnail(max_edge, max_edge)
}

// Human: Encode RGB8 image data as JPEG with a fixed quality suitable for grid tiles.
// Agent: WRITES into Vec<u8>; RETURNS bytes for storage.put.
pub(crate) fn encode_jpeg(image: &DynamicImage, quality: u8) -> Result<Vec<u8>, String> {
    let rgb = image.to_rgb8();
    let (width, height) = rgb.dimensions();
    let mut out = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut out, quality);
    encoder
        .encode(
            rgb.as_raw(),
            width,
            height,
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("jpeg encode failed: {e}"))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    #[test]
    fn generate_grid_thumbnail_jpeg_from_small_png() {
        let img: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_fn(32, 24, |x, y| {
            Rgb([(x * 8) as u8, (y * 8) as u8, 128])
        });
        let mut png = Vec::new();
        img.write_to(
            &mut std::io::Cursor::new(&mut png),
            image::ImageFormat::Png,
        )
        .expect("png encode");

        let jpeg = generate_grid_thumbnail_jpeg(&png).expect("thumbnail");
        assert!(!jpeg.is_empty());
        assert!(jpeg.starts_with(&[0xFF, 0xD8]));
    }
}
