import { Box, Container, Typography, Paper, Stack, Chip, Dialog, IconButton } from "@mui/material"
import type { SxProps, Theme } from "@mui/material"
import StorageIcon from "@mui/icons-material/Storage"
import CloseIcon from "@mui/icons-material/Close"
import { useState } from "react"
import ScrollReveal from "./ScrollReveal"

const BASE = import.meta.env.BASE_URL

const styles: Record<string, SxProps<Theme>> = {
  section: {
    py: { xs: 8, md: 12 },
    bgcolor: "background.default",
  },
  title: {
    textAlign: "center",
    fontWeight: 700,
  },
  subtitle: {
    textAlign: "center",
    mt: 1,
    mb: 2,
    maxWidth: 500,
    mx: "auto",
  },
  card: {
    borderRadius: "16px",
    overflow: "hidden",
    border: "2px solid",
    display: "flex",
    flexDirection: "column",
  },
  mediaWrapper: {
    width: "100%",
    bgcolor: "#f5f5f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    p: 2,
  },
  media: {
    display: "block",
    width: "100%",
    height: "auto",
    minHeight: "320px",
    objectFit: "contain",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "opacity 0.2s",
    "&:hover": { opacity: 0.85 },
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

export default function JBoxSection() {
  const [previewImg, setPreviewImg] = useState<string | null>(null)

  return (
    <>
      <Box id="jbox" sx={styles.section}>
        <Container maxWidth="lg">
          <ScrollReveal>
            <Box sx={{ textAlign: "center", mb: 4 }}>
              <Typography variant="h3" sx={styles.title}>
                一键上传到交大云盘
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={styles.subtitle}>
                从应用内直接上传，文件自动保存至交大云盘，无需手动下载再上传
              </Typography>
            </Box>
          </ScrollReveal>

          <Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ mt: 4, alignItems: "center" }}>
            <ScrollReveal delay={100} sx={{ flex: 1, minWidth: 0, width: "100%" }}>
              <Paper elevation={0} sx={{ ...styles.card, borderColor: "primary.light" }}>
                <Box sx={styles.mediaWrapper}>
                  <Box
                    component="img"
                    src={`${BASE}canvas_helper_upload.png`}
                    alt="Canvas Helper 一键上传界面"
                    sx={styles.media}
                    onClick={() => setPreviewImg(`${BASE}canvas_helper_upload.png`)}
                  />
                </Box>
                <Box sx={{ p: 2.5, textAlign: "center" }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Canvas Helper</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>选中文件，一键上传到交大云盘</Typography>
                </Box>
              </Paper>
            </ScrollReveal>

            <Box sx={styles.arrowH}>→</Box>
            <Box sx={styles.arrowV}>↓</Box>

            <ScrollReveal delay={150} sx={{ flex: 1, minWidth: 0, width: "100%" }}>
              <Paper elevation={0} sx={{ ...styles.card, borderColor: "success.light" }}>
                <Box sx={styles.mediaWrapper}>
                  <Box
                    component="img"
                    src={`${BASE}pan_upload.png`}
                    alt="交大云盘文件列表"
                    sx={styles.media}
                    onClick={() => setPreviewImg(`${BASE}pan_upload.png`)}
                  />
                </Box>
                <Box sx={{ p: 2.5, textAlign: "center" }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, color: "success.dark" }}>
                    交大云盘 (pan.sjtu.edu.cn)
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>文件自动出现在云盘，随时随地访问</Typography>
                </Box>
              </Paper>
            </ScrollReveal>
          </Stack>

          <ScrollReveal delay={300}>
            <Box sx={{ textAlign: "center", mt: 5 }}>
              <Chip
                icon={<StorageIcon />}
                label="支持交大云盘（新）pan.sjtu.edu.cn"
                color="success"
                variant="outlined"
                sx={{ fontWeight: 500, py: 0.5, fontSize: "0.85rem" }}
              />
            </Box>
          </ScrollReveal>
        </Container>
      </Box>

      {/* Image preview dialog */}
      <Dialog
        open={!!previewImg}
        onClose={() => setPreviewImg(null)}
        maxWidth="lg"
        slotProps={{
          paper: {
            sx: { borderRadius: "16px", overflow: "hidden", bgcolor: "transparent", boxShadow: "none" },
          },
        }}
      >
        <IconButton
          onClick={() => setPreviewImg(null)}
          sx={{ position: "absolute", top: 8, right: 8, zIndex: 1, bgcolor: "rgba(0,0,0,0.5)", color: "#fff", "&:hover": { bgcolor: "rgba(0,0,0,0.7)" } }}
        >
          <CloseIcon />
        </IconButton>
        {previewImg && (
          <Box
            component="img"
            src={previewImg}
            alt="预览大图"
            sx={{ maxWidth: "90vw", maxHeight: "90vh", display: "block" }}
          />
        )}
      </Dialog>
    </>
  )
}
