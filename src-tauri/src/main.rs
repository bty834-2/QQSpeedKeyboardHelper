#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use image::{ImageBuffer, Rgba};
use std::fs;
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1] == "gen-icon" {
        let size = 256;
        let mut img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::new(size, size);

        for (x, y, pixel) in img.enumerate_pixels_mut() {
            let r = (x as f32 / size as f32 * 255.0) as u8;
            let g = (y as f32 / size as f32 * 255.0) as u8;
            *pixel = Rgba([r, g, 150, 255]);
        }

        let icons_dir = Path::new("icons");
        if !icons_dir.exists() {
            fs::create_dir_all(icons_dir).unwrap();
        }

        img.save("icons/icon.png").unwrap();
        println!("Generated icons/icon.png");
        return;
    }
    app_lib::run();
}
