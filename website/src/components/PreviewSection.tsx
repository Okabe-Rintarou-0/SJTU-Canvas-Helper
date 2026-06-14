import { Box, Container, Typography, Paper, Stack, Chip } from "@mui/material"
import type { SxProps, Theme } from "@mui/material"
import ScrollReveal from "./ScrollReveal"

const BASE = import.meta.env.BASE_URL

const styles: Record<string, SxProps<Theme>> = {
  section: {
    py: { xs: 8, md: 12 },
    background: "linear-gradient(180deg, #f8faff 0%, #fff 100%)",
  },
  title: {
    textAlign: "center",
    fontWeight: 700,
  },
  subtitle: {
    textAlign: "center",
    mt: 1,
    mb: 2,
    maxWidth: 600,
    mx: "auto",
  },
  card: {
    borderRadius: "16px",
    overflow: "hidden",
    border: "1px solid",
    borderColor: "divider",
    display: "flex",
    flexDirection: "column",
  },
  cardHighlight: {
    borderRadius: "16px",
    overflow: "hidden",
    border: "2px solid",
    borderColor: "success.light",
    display: "flex",
    flexDirection: "column",
  },
  videoWrapper: {
    width: "100%",
    bgcolor: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  video: {
    display: "block",
    width: "100%",
    height: "auto",
    minHeight: "320px",
    objectFit: "contain",
  },
  arrowH: {
    display: { xs: "none", md: "flex" },
    alignItems: "center",
    justifyContent: "center",
    fontSize: "3.5rem",
    color: "primary.main",
    fontWeight: 700,
    minWidth: 72,
  },
  arrowV: {
    display: { xs: "flex", md: "none" },
    justifyContent: "center",
    fontSize: "2.5rem",
    color: "primary.main",
    py: 1,
  },
}

export default function PreviewSection() {
  return (
    <Box id="preview" sx={styles.section}>
      <Container maxWidth="lg">
        <ScrollReveal>
          <Box sx={{ textAlign: "center", mb: 4 }}>
            <Typography variant="h3" sx={styles.title}>
              免下载 · 超快速在线浏览
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={styles.subtitle}>
              告别繁琐下载，按下空格即刻预览各类文档，包括压缩包
            </Typography>
          </Box>
        </ScrollReveal>

        <Stack direction={{ xs: "column", md: "row" }} spacing={4} sx={{ mt: 4, alignItems: "stretch" }}>
          <ScrollReveal delay={100} sx={{ flex: 1, minWidth: 0 }}>
            <Box>
              <Chip label="❌ 传统 Canvas 网页" color="error" variant="outlined" size="small" sx={{ mb: 1.5, fontWeight: 600 }} />
              <Paper elevation={0} sx={styles.card}>
                <Box sx={styles.videoWrapper}>
                  <Box
                    component="video"
                    src={`${BASE}cavas_web_file_view.mp4`}
                    sx={styles.video}
                    controls
                    muted
                    playsInline
                    preload="metadata"
                  />
                </Box>
                <Box sx={{ p: 3 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>传统方式</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    不支持预览压缩包 → 逐个下载文件 → 解压 → 打开查看 → 反复操作
                  </Typography>
                </Box>
              </Paper>
            </Box>
          </ScrollReveal>

          <Box sx={styles.arrowH}>→</Box>
          <Box sx={styles.arrowV}>↓</Box>

          <ScrollReveal delay={200} sx={{ flex: 1, minWidth: 0 }}>
            <Box>
              <Chip label="✅ Canvas Helper 体验" color="success" variant="outlined" size="small" sx={{ mb: 1.5, fontWeight: 600 }} />
              <Paper elevation={0} sx={styles.cardHighlight}>
                <Box sx={styles.videoWrapper}>
                  <Box
                    component="video"
                    src={`${BASE}canvas_helper_file_view.mp4`}
                    sx={styles.video}
                    controls
                    muted
                    playsInline
                    preload="metadata"
                  />
                </Box>
                <Box sx={{ p: 3 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, color: "success.dark" }}>
                    Canvas Helper 方式
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    按下空格预览 → 查看完毕关闭 → 无需下载解压
                  </Typography>
                </Box>
              </Paper>
            </Box>
          </ScrollReveal>
        </Stack>

        <ScrollReveal delay={300}>
          <Box sx={{ textAlign: "center", mt: 5 }}>
            <Chip
              label="⚡ 支持格式：PDF · DOCX · XLSX · Markdown · 代码 · 图片 · IPYNB · ZIP/RAR/7Z"
              color="primary"
              variant="outlined"
              sx={{ fontWeight: 500, py: 0.5, fontSize: "0.85rem" }}
            />
          </Box>
        </ScrollReveal>
      </Container>
    </Box>
  )
}
