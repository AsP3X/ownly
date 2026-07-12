// Human: Extract cover image bytes from an EPUB archive for explorer grid thumbnails.
// Agent: READS ZIP + OPF manifest; RETURNS raster bytes; CALLED by document/thumbnail.rs.

use std::io::{Cursor, Read};

use quick_xml::events::Event;
use quick_xml::Reader;
use zip::ZipArchive;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ManifestItem {
    id: String,
    href: String,
    media_type: String,
    properties: Option<String>,
}

// Human: Locate the cover raster inside an EPUB byte buffer.
// Agent: OPENS ZipArchive; PARSES container.xml + OPF; READS cover href from manifest rules.
pub fn extract_epub_cover_image_bytes(epub_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let cursor = Cursor::new(epub_bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|e| format!("epub zip open failed: {e}"))?;

    let container_xml = read_zip_entry(&mut archive, "META-INF/container.xml")?;
    let opf_path = parse_container_opf_path(&container_xml)?;
    let opf_xml = read_zip_entry(&mut archive, &opf_path)?;
    let opf_base = opf_parent_dir(&opf_path);

    let manifest = parse_opf_manifest(&opf_xml)?;
    let cover_href = resolve_cover_href(&opf_xml, &manifest)?;
    let cover_path = join_epub_path(&opf_base, &cover_href);
    read_zip_entry(&mut archive, &cover_path)
}

// Human: Decode EPUB cover raster and encode a bounded explorer JPEG sidecar.
// Agent: CALLS extract_epub_cover_image_bytes; RESIZES with DOCUMENT_PREVIEW_MAX_EDGE.
pub fn generate_epub_cover_preview_jpeg(
    epub_bytes: &[u8],
    max_edge: u32,
    jpeg_quality: u8,
) -> Result<Vec<u8>, String> {
    use crate::image::thumbnail::{encode_jpeg, resize_to_max_edge};

    let cover_bytes = extract_epub_cover_image_bytes(epub_bytes)?;
    if cover_bytes.len() < 32 {
        return Err("epub cover image is empty".into());
    }

    let decoded = image::ImageReader::new(Cursor::new(cover_bytes))
        .with_guessed_format()
        .map_err(|e| format!("epub cover format guess failed: {e}"))?
        .decode()
        .map_err(|e| format!("epub cover decode failed: {e}"))?;

    let bounded = resize_to_max_edge(decoded, max_edge);
    encode_jpeg(&bounded, jpeg_quality)
}

// Human: Read one ZIP member into memory using normalized forward-slash paths.
// Agent: NORMALIZES leading slashes; RETURNS bytes or missing-entry error.
fn read_zip_entry(archive: &mut ZipArchive<Cursor<&[u8]>>, path: &str) -> Result<Vec<u8>, String> {
    let normalized = normalize_zip_path(path);
    let mut entry = archive
        .by_name(&normalized)
        .map_err(|_| format!("epub zip entry not found: {normalized}"))?;
    let mut bytes = Vec::new();
    entry
        .read_to_end(&mut bytes)
        .map_err(|e| format!("epub zip read failed for {normalized}: {e}"))?;
    Ok(bytes)
}

// Human: Strip leading slashes so zip crate lookups match EPUB conventions.
fn normalize_zip_path(path: &str) -> String {
    path.trim_start_matches('/').replace('\\', "/")
}

// Human: Parent directory of the OPF package file — cover hrefs are relative to this folder.
fn opf_parent_dir(opf_path: &str) -> String {
    let normalized = normalize_zip_path(opf_path);
    normalized
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .unwrap_or_default()
}

// Human: Join OPF directory prefix with a manifest href.
// Agent: HANDLES absolute-ish hrefs and nested image folders.
fn join_epub_path(base: &str, href: &str) -> String {
    let href = normalize_zip_path(href);
    if href.is_empty() {
        return base.to_string();
    }
    if base.is_empty() {
        return href;
    }
    format!("{base}/{href}")
}

// Human: Parse META-INF/container.xml and return the OPF full-path attribute.
// Agent: READS first rootfile@full-path; REQUIRED for EPUB container spec.
fn parse_container_opf_path(container_xml: &[u8]) -> Result<String, String> {
    let mut reader = Reader::from_reader(container_xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(tag)) | Ok(Event::Empty(tag)) => {
                if tag.name().as_ref() == b"rootfile" {
                    for attr in tag.attributes().flatten() {
                        if attr.key.as_ref() == b"full-path" {
                            let value = attr
                                .decode_and_unescape_value(reader.decoder())
                                .map_err(|e| format!("container full-path decode failed: {e}"))?;
                            return Ok(value.into_owned());
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("container.xml parse failed: {error}")),
            _ => {}
        }
        buf.clear();
    }

    Err("container.xml missing rootfile full-path".into())
}

// Human: Collect manifest items from the OPF package document.
// Agent: READS item@id, href, media-type, properties from <manifest>.
fn parse_opf_manifest(opf_xml: &[u8]) -> Result<Vec<ManifestItem>, String> {
    let mut reader = Reader::from_reader(opf_xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut in_manifest = false;
    let mut items = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(tag)) => {
                if tag.name().as_ref() == b"manifest" {
                    in_manifest = true;
                } else if in_manifest && tag.name().as_ref() == b"item" {
                    if let Some(item) = parse_manifest_item_tag(&tag, &reader)? {
                        items.push(item);
                    }
                }
            }
            Ok(Event::Empty(tag)) => {
                if in_manifest && tag.name().as_ref() == b"item" {
                    if let Some(item) = parse_manifest_item_tag(&tag, &reader)? {
                        items.push(item);
                    }
                }
            }
            Ok(Event::End(tag)) => {
                if tag.name().as_ref() == b"manifest" {
                    in_manifest = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(format!("opf manifest parse failed: {error}")),
            _ => {}
        }
        buf.clear();
    }

    if items.is_empty() {
        return Err("opf manifest has no items".into());
    }

    Ok(items)
}

// Human: Parse one OPF manifest <item> start/empty tag into a ManifestItem row.
// Agent: READS id, href, media-type, properties attributes.
fn parse_manifest_item_tag(
    tag: &quick_xml::events::BytesStart,
    reader: &Reader<&[u8]>,
) -> Result<Option<ManifestItem>, String> {
    let mut id = None;
    let mut href = None;
    let mut media_type = None;
    let mut properties = None;

    for attr in tag.attributes().flatten() {
        match attr.key.as_ref() {
            b"id" => {
                id = Some(
                    attr.decode_and_unescape_value(reader.decoder())
                        .map_err(|e| format!("manifest id decode failed: {e}"))?
                        .into_owned(),
                );
            }
            b"href" => {
                href = Some(
                    attr.decode_and_unescape_value(reader.decoder())
                        .map_err(|e| format!("manifest href decode failed: {e}"))?
                        .into_owned(),
                );
            }
            b"media-type" => {
                media_type = Some(
                    attr.decode_and_unescape_value(reader.decoder())
                        .map_err(|e| format!("manifest media-type decode failed: {e}"))?
                        .into_owned(),
                );
            }
            b"properties" => {
                properties = Some(
                    attr.decode_and_unescape_value(reader.decoder())
                        .map_err(|e| format!("manifest properties decode failed: {e}"))?
                        .into_owned(),
                );
            }
            _ => {}
        }
    }

    if let (Some(id), Some(href), Some(media_type)) = (id, href, media_type) {
        return Ok(Some(ManifestItem {
            id,
            href,
            media_type,
            properties,
        }));
    }

    Ok(None)
}

// Human: Resolve which manifest href holds the cover image.
// Agent: ORDER cover-image property → meta name=cover → first image/* manifest item.
fn resolve_cover_href(opf_xml: &[u8], manifest: &[ManifestItem]) -> Result<String, String> {
    if let Some(item) = manifest.iter().find(|item| {
        item.properties
            .as_deref()
            .is_some_and(|props| props.split_whitespace().any(|part| part == "cover-image"))
    }) {
        return Ok(item.href.clone());
    }

    if let Some(cover_id) = parse_cover_meta_id(opf_xml) {
        if let Some(item) = manifest.iter().find(|item| item.id == cover_id) {
            return Ok(item.href.clone());
        }
    }

    manifest
        .iter()
        .find(|item| item.media_type.to_ascii_lowercase().starts_with("image/"))
        .map(|item| item.href.clone())
        .ok_or_else(|| "epub cover image not found in manifest".into())
}

// Human: Read EPUB2-style <meta name="cover" content="manifest-id"/> from OPF metadata.
// Agent: SCANS metadata section; RETURNS content attribute when name=cover.
fn parse_cover_meta_id(opf_xml: &[u8]) -> Option<String> {
    let mut reader = Reader::from_reader(opf_xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut in_metadata = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(tag)) | Ok(Event::Empty(tag)) => {
                if tag.name().as_ref() == b"metadata" {
                    in_metadata = true;
                } else if in_metadata && tag.name().as_ref() == b"meta" {
                    let mut name = None;
                    let mut content = None;
                    for attr in tag.attributes().flatten() {
                        match attr.key.as_ref() {
                            b"name" => {
                                name = attr
                                    .decode_and_unescape_value(reader.decoder())
                                    .ok()
                                    .map(|v| v.into_owned());
                            }
                            b"content" => {
                                content = attr
                                    .decode_and_unescape_value(reader.decoder())
                                    .ok()
                                    .map(|v| v.into_owned());
                            }
                            _ => {}
                        }
                    }
                    if name.as_deref() == Some("cover") {
                        return content;
                    }
                }
            }
            Ok(Event::End(tag)) => {
                if tag.name().as_ref() == b"metadata" {
                    in_metadata = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return None,
            _ => {}
        }
        buf.clear();
    }

    None
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    const CONTAINER_XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

    const OPF_WITH_COVER_IMAGE_PROPERTY: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">test-book</dc:identifier>
  </metadata>
  <manifest>
    <item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="chapter-1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
</package>"#;

    const OPF_WITH_COVER_META: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">test-book</dc:identifier>
    <meta name="cover" content="cover-id"/>
  </metadata>
  <manifest>
    <item id="cover-id" href="images/cover.png" media-type="image/png"/>
    <item id="chapter-1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
</package>"#;

    fn tiny_jpeg_bytes() -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(8, 12, image::Rgba([120, 80, 200, 255]));
        let mut buffer = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut buffer, image::ImageFormat::Jpeg)
            .expect("jpeg encode");
        buffer.into_inner()
    }

    fn tiny_png_bytes() -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(10, 14, image::Rgba([20, 140, 90, 255]));
        let mut buffer = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut buffer, image::ImageFormat::Png)
            .expect("png encode");
        buffer.into_inner()
    }

    // Human: Build an in-memory EPUB ZIP for parser tests.
    // Agent: WRITES container.xml, OPF, and cover bytes via ZipWriter.
    fn build_test_epub(
        opf_xml: &str,
        cover_zip_path: &str,
        cover_bytes: &[u8],
    ) -> Vec<u8> {
        let buffer = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(buffer);
        let options = SimpleFileOptions::default();

        writer
            .start_file("META-INF/container.xml", options)
            .expect("container start");
        writer
            .write_all(CONTAINER_XML.as_bytes())
            .expect("container write");
        writer
            .start_file("OEBPS/content.opf", options)
            .expect("opf start");
        writer.write_all(opf_xml.as_bytes()).expect("opf write");
        writer
            .start_file(cover_zip_path, options)
            .expect("cover start");
        writer.write_all(cover_bytes).expect("cover write");
        writer.finish().expect("zip finish").into_inner()
    }

    #[test]
    fn extracts_cover_via_cover_image_property() {
        let epub = build_test_epub(
            OPF_WITH_COVER_IMAGE_PROPERTY,
            "OEBPS/cover.jpg",
            &tiny_jpeg_bytes(),
        );
        let cover = extract_epub_cover_image_bytes(&epub).expect("cover bytes");
        assert!(cover.starts_with(&[0xFF, 0xD8]));
    }

    #[test]
    fn extracts_cover_via_meta_name_cover() {
        let epub = build_test_epub(
            OPF_WITH_COVER_META,
            "OEBPS/images/cover.png",
            &tiny_png_bytes(),
        );
        let cover = extract_epub_cover_image_bytes(&epub).expect("cover bytes");
        assert!(cover.starts_with(&[0x89, b'P', b'N', b'G']));
    }

    #[test]
    fn generates_jpeg_preview_from_epub_cover() {
        let epub = build_test_epub(
            OPF_WITH_COVER_IMAGE_PROPERTY,
            "OEBPS/cover.jpg",
            &tiny_jpeg_bytes(),
        );
        let jpeg = generate_epub_cover_preview_jpeg(&epub, 1200, 90).expect("preview jpeg");
        assert!(jpeg.starts_with(&[0xFF, 0xD8]));
        assert!(jpeg.len() > 128);
    }

    #[test]
    fn errors_when_manifest_has_no_cover_image() {
        let opf = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest>
    <item id="chapter-1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
</package>"#;
        let epub = build_test_epub(opf, "OEBPS/cover.jpg", &tiny_jpeg_bytes());
        let error = extract_epub_cover_image_bytes(&epub).expect_err("missing cover");
        assert!(error.contains("cover image not found"));
    }
}
