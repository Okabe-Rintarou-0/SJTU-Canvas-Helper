//! Opt-in audit of a local service snapshot using the production policy.
#[test]
#[ignore = "requires SJTU_PPT_AUDIT_INPUT and SJTU_PPT_AUDIT_OUTPUT"]
fn audit_ppt_pages_from_snapshot() {
    use super::ppt::{clean_up_slides, simplify_animation_slides};
    use crate::model::CanvasVideoPPT;
    use serde_json::json;
    use std::fs;
    let input = std::env::var("SJTU_PPT_AUDIT_INPUT").expect("set input path");
    let output = std::env::var("SJTU_PPT_AUDIT_OUTPUT").expect("set output path");
    let mut data: serde_json::Value = serde_json::from_slice(&fs::read(input).unwrap()).unwrap();
    for course in data["courses"].as_array_mut().unwrap() {
        for video in course["videos"].as_array_mut().unwrap() {
            let Some(raw) = video.as_object_mut().unwrap().remove("slides") else {
                continue;
            };
            let slides: Vec<CanvasVideoPPT> = serde_json::from_value(raw).unwrap();
            let (off, notes) = clean_up_slides(slides.clone(), false);
            assert_eq!(off, slides);
            assert!(notes.is_empty());
            let (simplified, _) = simplify_animation_slides(slides.clone(), true);
            let (kept, notes) = clean_up_slides(slides.clone(), true);
            assert!(kept.len() <= slides.len());
            let ocr_count = |rows: &[CanvasVideoPPT]| {
                rows.iter()
                    .filter(|p| {
                        !p.ocr_text.trim().is_empty()
                            || p.ocr.iter().any(|w| !w.word.trim().is_empty())
                    })
                    .count()
            };
            video["counts"] = json!({
                "before": slides.len(), "after": kept.len(),
                "imageBefore": slides.iter().filter(|p| p.ppt_img_url.is_some()).count(),
                "imageAfter": kept.iter().filter(|p| p.ppt_img_url.is_some()).count(),
                "ocrBefore": ocr_count(&slides), "ocrAfter": ocr_count(&kept),
                "animationRemoved": slides.len() - simplified.len(),
                "desktopRemoved": notes.iter().filter(|n| n.contains("识别为Windows 桌面")).count(),
                "attendanceRemoved": notes.iter().filter(|n| n.contains("识别为签到页面")).count(),
            });
            video["notes"] = json!(notes);
        }
    }
    data["policy"] =
        json!("导出 PPT 时去除无用页面：仅连续切片合并，过滤明确桌面/签到；禁止跨页面回访合并");
    fs::write(output, serde_json::to_vec_pretty(&data).unwrap()).unwrap();
    println!(
        "Audited {} courses with the production PPT policy.",
        data["courses"].as_array().unwrap().len()
    );
}
