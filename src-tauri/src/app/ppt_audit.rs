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
            let index_of = |slide: &CanvasVideoPPT| {
                slides
                    .iter()
                    .position(|source| {
                        source.create_sec == slide.create_sec
                            && source.ppt_img_url == slide.ppt_img_url
                    })
                    .unwrap()
            };
            video["keptIndices"] = json!(kept.iter().map(index_of).collect::<Vec<_>>());
            video["mergedGroups"] = json!(simplified
                .iter()
                .filter(|s| !s.related_slide_secs.is_empty())
                .map(|s| {
                    let mut members: Vec<_> = slides
                        .iter()
                        .enumerate()
                        .filter(|(_, source)| {
                            source.create_sec == s.create_sec
                                || s.related_slide_secs.contains(&source.create_sec)
                        })
                        .map(|(i, _)| i)
                        .collect();
                    members.sort_unstable();
                    assert!(
                        members.windows(2).all(|pair| pair[1] == pair[0] + 1),
                        "merged group must be an original contiguous interval"
                    );
                    json!({"chosen": index_of(s), "members": members})
                })
                .collect::<Vec<_>>());
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
                "loginRemoved": notes.iter().filter(|n| n.contains("识别为Canvas 登录页面") || n.contains("识别为统一身份认证页面")).count(),
            });
            video["notes"] = json!(notes);
        }
    }
    data["policy"] =
        json!("仅原始连续切片；近重复双向覆盖至少95%，增量覆盖至少90%；保留数字、公式及缺失正文保护；同类括号宽度等价；过滤明确桌面/签到/登录");
    data.as_object_mut().unwrap().remove("comparisonImages");
    fs::write(output, serde_json::to_vec_pretty(&data).unwrap()).unwrap();
    println!(
        "Audited {} courses with the production PPT policy.",
        data["courses"].as_array().unwrap().len()
    );
}
