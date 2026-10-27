import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import QrCode2RoundedIcon from "@mui/icons-material/QrCode2Rounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import { Alert, Box, Button, Card, CardActionArea, CardContent, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, Stack, TextField, Typography } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import CourseSelect from "../components/course_select";
import BasicLayout from "../components/layout";
import { WorkspaceHero } from "../components/workspace_hero";
import { useCourses, useSelectedCourse } from "../lib/hooks";
import { QRCodeScanReport, QRCodeScanResult } from "../lib/model";
import { surfaceCardSx } from "../lib/styles";

export default function QRCodePage() {
  const { selectedCourseId, setSelectedCourseId } = useSelectedCourse();
  const courses = useCourses();
  const selectedCourse = courses.data.find((course) => course.id === selectedCourseId);
  const [operating, setOperating] = useState(false);
  const [report, setReport] = useState<QRCodeScanReport | null>(null);
  const [error, setError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [previewImage, setPreviewImage] = useState<QRCodeScanResult | null>(null);
  const [notice, setNotice] = useState<{ severity: "success" | "error"; text: string } | null>(null);
  const requestId = useRef(0);

  const scanCourse = useCallback(async (courseId?: number) => {
    const currentRequest = ++requestId.current;
    setReport(null);
    setError("");
    setNotice(null);
    setPreviewImage(null);
    setOperating(Boolean(courseId && courseId > 0));
    if (!courseId || courseId <= 0) return;
    try {
      const next = await invoke<QRCodeScanReport>("scan_course_qrcodes", { courseId });
      if (requestId.current === currentRequest) setReport(next);
    } catch {
      if (requestId.current === currentRequest) setError("无法扫描该课程的图片，请检查网络和 Canvas 登录状态后重试。");
    } finally {
      if (requestId.current === currentRequest) setOperating(false);
    }
  }, []);

  useEffect(() => {
    setKeyword("");
    void scanCourse(selectedCourse?.id);
    return () => { requestId.current += 1; };
  }, [selectedCourse?.id, scanCourse]);

  const filteredResults = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return (report?.results ?? []).filter((item) => !query ||
      item.file.display_name.toLowerCase().includes(query) || item.contents.some((content) => content.toLowerCase().includes(query)));
  }, [keyword, report]);

  const copyContent = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setNotice({ severity: "success", text: "二维码内容已复制。" });
    } catch {
      setNotice({ severity: "error", text: "复制失败，请手动选择下方内容复制。" });
    }
  };

  const renderContents = (contents: string[]) => (
    <Stack spacing={1}>
      {contents.map((content, index) => (
        <Stack key={content} direction="row" spacing={1} alignItems="flex-start">
          <Typography component="code" variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", userSelect: "text" }}>{content}</Typography>
          <Button size="small" startIcon={<ContentCopyRoundedIcon />} sx={{ flexShrink: 0 }}
            aria-label={`复制第 ${index + 1} 个二维码内容`} onClick={() => void copyContent(content)}>复制</Button>
        </Stack>
      ))}
    </Stack>
  );

  return (
    <BasicLayout>
      <Stack spacing={2.5}>
        <WorkspaceHero chipLabel="二维码管理" chipIcon={<QrCode2RoundedIcon />} title="二维码识别"
          description="识别课程文件中的图片二维码，支持反色码、内容复制与原图核对。"
          aside={
            <Box sx={{ width: { xs: "100%", lg: 480 }, minWidth: 0 }}>
              <CourseSelect courses={courses.data} onChange={setSelectedCourseId} value={selectedCourseId > 0 ? selectedCourseId : undefined} />
            </Box>
          }
          footer={
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between">
              <Typography variant="body2" color="text.secondary" role="status">
                {operating ? "正在下载并识别课程图片…" : report
                  ? `已扫描 ${report.scanned_images} / ${report.image_files} 张图片，${report.results.length} 张包含二维码。`
                  : "选择课程后自动扫描，也可以随时重新扫描。"}
              </Typography>
              <Button variant="outlined" disabled={!selectedCourse || operating} onClick={() => void scanCourse(selectedCourse?.id)}
                startIcon={operating ? <CircularProgress size={16} color="inherit" /> : <RefreshRoundedIcon />} sx={{ flexShrink: 0 }}>
                {operating ? "扫描中…" : "重新扫描"}
              </Button>
            </Stack>
          }
        />

        <Card sx={surfaceCardSx}>
          <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
            <Stack spacing={2}>
              <TextField size="small" fullWidth label="搜索识别结果" value={keyword} onChange={(event) => setKeyword(event.target.value)}
                placeholder="按文件名或二维码内容搜索…" disabled={!report?.results.length}
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon color="action" /></InputAdornment> }} />
              <Typography variant="caption" color="text.secondary">
                扫描课程文件中的独立图片（JPG、PNG、GIF、WebP 等），暂不扫描 PDF／PPT 内嵌图片。单张图片上限 32 MiB。
              </Typography>
              {notice && <Alert severity={notice.severity} onClose={() => setNotice(null)}>{notice.text}</Alert>}
              {report && report.failed_images > 0 && <Alert severity="warning">
                有 {report.failed_images} 张图片未能下载或解码，结果可能不完整。可重新扫描；图片损坏、格式不受支持或超过大小限制也会导致失败。
              </Alert>}
              {error ? <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void scanCourse(selectedCourse?.id)}>重试</Button>}>{error}</Alert>
                : operating ? (
                  <Stack spacing={1.5} alignItems="center" sx={{ py: 6 }}>
                    <CircularProgress /><Typography variant="body2" color="text.secondary">正在扫描，请稍候…</Typography>
                  </Stack>
                ) : filteredResults.length ? (
                  <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" } }}>
                    {filteredResults.map((result) => (
                      <Card key={result.file.id} variant="outlined" sx={{ minWidth: 0, boxShadow: "none" }}>
                        <CardActionArea onClick={() => setPreviewImage(result)} aria-label={`查看原图：${result.file.display_name}`}>
                          <Box component="img" src={result.file.url} alt={result.file.display_name}
                            sx={{ width: "100%", height: 240, objectFit: "contain", display: "block", bgcolor: "action.hover" }} />
                          <CardContent sx={{ p: 2 }}>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>{result.file.display_name}</Typography>
                            <Typography variant="caption" color="text.secondary">识别到 {result.contents.length} 个二维码 · 点击查看完整原图</Typography>
                          </CardContent>
                        </CardActionArea>
                        <Box sx={{ px: 2, pb: 2 }}>{renderContents(result.contents)}</Box>
                      </Card>
                    ))}
                  </Box>
                ) : <Alert severity="info">
                  {!selectedCourse ? "请先在上方选择课程。" : keyword.trim() ? "没有匹配的识别结果，请调整搜索条件。"
                    : report?.image_files === 0 ? "课程文件中没有可扫描的独立图片；PDF／PPT 内的二维码暂不在扫描范围内。"
                    : report?.failed_images === report?.image_files && report?.failed_images ? "本次图片均扫描失败，请重试。"
                    : "扫描完成，暂未识别到二维码。可核对原图清晰度，或在课程文件更新后重新扫描。"}
                </Alert>}
            </Stack>
          </CardContent>
        </Card>
      </Stack>
      <Dialog open={Boolean(previewImage)} onClose={() => setPreviewImage(null)} fullWidth maxWidth="md" aria-labelledby="qrcode-preview-title">
        <DialogTitle id="qrcode-preview-title">{previewImage?.file.display_name}</DialogTitle>
        <DialogContent dividers>
          {previewImage && <Stack spacing={2}>
            <Box component="img" src={previewImage.file.url} alt={previewImage.file.display_name}
              sx={{ width: "100%", maxHeight: "60vh", objectFit: "contain", display: "block" }} />
            {renderContents(previewImage.contents)}
            {notice && <Alert severity={notice.severity}>{notice.text}</Alert>}
          </Stack>}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}><Button onClick={() => setPreviewImage(null)}>关闭</Button></DialogActions>
      </Dialog>
    </BasicLayout>
  );
}
