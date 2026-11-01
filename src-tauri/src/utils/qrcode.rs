use image::{imageops::FilterType, DynamicImage, GenericImageView};

/// Decode ordinary and light-on-dark QR codes without writing a temporary file.
pub fn decode_image(content: &[u8]) -> Result<Vec<String>, image::ImageError> {
    let mut reader = image::io::Reader::new(std::io::Cursor::new(content)).with_guessed_format()?;
    let mut limits = image::io::Limits::default();
    limits.max_image_width = Some(12_000);
    limits.max_image_height = Some(12_000);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode()?;
    if image.width() < 21 || image.height() < 21 {
        return Ok(Vec::new());
    }
    let mut rgba = image.to_rgba8();
    for pixel in rgba.pixels_mut() {
        let alpha = u32::from(pixel[3]);
        if alpha != 255 {
            for channel in &mut pixel.0[..3] {
                *channel = ((u32::from(*channel) * alpha + 255 * (255 - alpha)) / 255) as u8;
            }
            pixel[3] = 255;
        }
    }
    let image = DynamicImage::ImageRgba8(rgba);
    let image = if image.width().max(image.height()) > 2_400 {
        image.resize(2_400, 2_400, FilterType::Lanczos3)
    } else {
        image
    };
    let decoder = bardecoder::default_decoder();
    let mut contents = Vec::new();
    let mut scan = |image: &DynamicImage| {
        for content in decoder.decode(image).into_iter().flatten() {
            if !contents.contains(&content) {
                contents.push(content);
            }
        }
    };
    scan(&image);
    let mut inverted = image.clone();
    inverted.invert();
    scan(&inverted);
    if contents.is_empty() {
        let (width, height) = image.dimensions();
        let resized = if width.max(height) < 600 {
            image.resize(width * 2, height * 2, FilterType::Nearest)
        } else {
            image.resize(
                (width / 2).max(1),
                (height / 2).max(1),
                FilterType::Triangle,
            )
        };
        for variant in [resized.clone(), {
            let mut image = resized;
            image.invert();
            image
        }] {
            for content in decoder.decode(&variant).into_iter().flatten() {
                if !contents.contains(&content) {
                    contents.push(content);
                }
            }
        }
    }
    Ok(contents)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_image() -> DynamicImage {
        // Generated with qrcode.react; payload is intentionally public test data.
        let rows = [
            "1111111010000001001111111",
            "1000001010000111101000001",
            "1011101010000011101011101",
            "1011101011010101101011101",
            "1011101011110111001011101",
            "1000001001111011101000001",
            "1111111010101010101111111",
            "0000000010111001100000000",
            "0110101101101000101011111",
            "0001000110001100101000111",
            "1001001001111010101101101",
            "1101000010100111101100011",
            "0011101101000010011101001",
            "0000100101011110111001001",
            "1010001011110010000110011",
            "0101110011010111100000000",
            "1010101000111111111110001",
            "0000000011100101100010001",
            "1111111010111011101011111",
            "1000001000000001100010011",
            "1011101010001110111110001",
            "1011101001000111100110000",
            "1011101011101001000111001",
            "1000001011000101101110010",
            "1111111001111001110011011",
        ];
        let mut image = image::GrayImage::from_pixel(132, 132, image::Luma([255]));
        for (y, row) in rows.iter().enumerate() {
            for (x, cell) in row.bytes().enumerate() {
                if cell == b'1' {
                    for dy in 0..4 {
                        for dx in 0..4 {
                            image.put_pixel(
                                (x as u32 + 4) * 4 + dx,
                                (y as u32 + 4) * 4 + dy,
                                image::Luma([0]),
                            );
                        }
                    }
                }
            }
        }
        DynamicImage::ImageLuma8(image)
    }

    fn encoded(image: &DynamicImage) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut out, image::ImageOutputFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn decodes_both_polarities_without_duplicates() {
        let mut image = sample_image();
        assert_eq!(
            decode_image(&encoded(&image)).unwrap(),
            ["qr-regression-test"]
        );
        image.invert();
        assert_eq!(
            decode_image(&encoded(&image)).unwrap(),
            ["qr-regression-test"]
        );
    }

    #[test]
    fn handles_blank_and_tiny_images() {
        for size in [1, 100] {
            let image = DynamicImage::ImageLuma8(image::GrayImage::from_pixel(
                size,
                size,
                image::Luma([255]),
            ));
            assert!(decode_image(&encoded(&image)).unwrap().is_empty());
        }
    }

    #[test]
    fn rejects_non_images() {
        assert!(decode_image(b"not an image").is_err());
    }
}
