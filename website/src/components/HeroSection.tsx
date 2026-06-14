import { Box, Container, Typography, Button, Chip, Stack } from "@mui/material"
import type { SxProps, Theme } from "@mui/material"
import DownloadIcon from "@mui/icons-material/Download"
import GitHubIcon from "@mui/icons-material/GitHub"
import StorageIcon from "@mui/icons-material/Storage"
import VisibilityIcon from "@mui/icons-material/Visibility"
import AssignmentIcon from "@mui/icons-material/Assignment"
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth"
import SmartToyIcon from "@mui/icons-material/SmartToy"
import ScrollReveal from "./ScrollReveal"

const styles: Record<string, SxProps<Theme>> = {
  section: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    pt: { xs: 10, md: 12 },
    background: "linear-gradient(135deg, #f5f7ff 0%, #e8f0fe 50%, #f0f5ff 100%)",
    position: "relative",
    overflow: "hidden",
  },
  blob1: {
    position: "absolute",
    top: -200,
    right: -200,
    width: 600,
    height: 600,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(26,115,232,0.08) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  blob2: {
    position: "absolute",
    bottom: -100,
    left: -100,
    width: 400,
    height: 400,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(232,69,26,0.06) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  blob3: {
    position: "absolute",
    top: "35%",
    left: "8%",
    width: 200,
    height: 200,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(255,152,0,0.05) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  blob4: {
    position: "absolute",
    bottom: "22%",
    right: "12%",
    width: 300,
    height: 300,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(76,175,80,0.05) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  title: {
    fontSize: { xs: "2.2rem", sm: "3rem", md: "3.8rem" },
    textAlign: "center",
    lineHeight: 1.15,
    mt: 3,
    background: "linear-gradient(135deg, #1a73e8 0%, #e8451a 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  subtitle: {
    textAlign: "center",
    color: "text.secondary",
    maxWidth: 640,
    mx: "auto",
    mt: 2,
    fontWeight: 400,
    lineHeight: 1.6,
    fontSize: { xs: "1rem", md: "1.15rem" },
  },
  btnRow: {
    mt: 4,
    justifyContent: "center",
  },
  cta: {
    px: 4,
    py: 1.5,
    fontSize: "1rem",
    borderRadius: "12px",
  },
  statRow: {
    mt: 8,
    flexWrap: "wrap",
    gap: 2,
    justifyContent: "center",
  },
  floatIcon: {
    position: "absolute",
    color: "primary.main",
    display: { xs: "none", md: "block" },
    "& svg": { fontSize: { xs: 28, md: 36 }, opacity: 0.15 },
  },
  platformRow: {
    mt: 3,
    justifyContent: "center",
    gap: 1.5,
    flexWrap: "wrap",
  },
  badge: {
    fontWeight: 600,
    borderColor: "primary.light",
    color: "primary.dark",
    bgcolor: "rgba(26,115,232,0.04)",
    "&:hover": { bgcolor: "rgba(26,115,232,0.1)" },
  },
}

const platformIcons = {
  Windows: "🪟",
  macOS: "🍎",
  Linux: "🐧",
} as const

export default function HeroSection() {
  return (
    <Box id="hero" sx={styles.section}>
      <Box sx={styles.blob1} />
      <Box sx={styles.blob2} />
      <Box sx={styles.blob3} />
      <Box sx={styles.blob4} />

      {/* Floating background icons */}
      <Box className="float-icon" sx={{ ...styles.floatIcon, top: "15%", left: "6%", animation: "float 7s ease-in-out infinite" }}>
        <StorageIcon />
      </Box>
      <Box className="float-icon" sx={{ ...styles.floatIcon, top: "22%", right: "8%", animation: "float 6s ease-in-out infinite", animationDelay: "0.5s" }}>
        <VisibilityIcon />
      </Box>
      <Box className="float-icon" sx={{ ...styles.floatIcon, bottom: "32%", left: "10%", animation: "float 8s ease-in-out infinite", animationDelay: "1s" }}>
        <AssignmentIcon />
      </Box>
      <Box className="float-icon" sx={{ ...styles.floatIcon, bottom: "18%", right: "6%", animation: "float 7s ease-in-out infinite", animationDelay: "1.5s" }}>
        <CalendarMonthIcon />
      </Box>
      <Box className="float-icon" sx={{ ...styles.floatIcon, top: "50%", left: "3%", animation: "float 9s ease-in-out infinite", animationDelay: "0.8s" }}>
        <SmartToyIcon />
      </Box>

      <Container maxWidth="lg">
        <ScrollReveal>
          <Box sx={{ textAlign: "center", mb: 1 }}>
            <Chip
              label="🚀 开源 · 免费 · 跨平台"
              variant="outlined"
              color="primary"
              sx={{ fontWeight: 600, px: 1 }}
            />
          </Box>
        </ScrollReveal>

        <ScrollReveal delay={80}>
          <Stack direction="row" spacing={1} sx={styles.platformRow}>
            {(["Windows", "macOS", "Linux"] as const).map((os) => (
              <Chip
                key={os}
                icon={<Box component="span" sx={{ fontSize: "1.1rem" }}>{platformIcons[os]}</Box>}
                label={os}
                variant="outlined"
                size="small"
                sx={styles.badge}
              />
            ))}
          </Stack>
        </ScrollReveal>

        <ScrollReveal delay={100}>
          <Typography variant="h1" sx={styles.title}>
            作业、文件、云盘
            <br />
            一个工具全搞定
          </Typography>
        </ScrollReveal>

        <ScrollReveal delay={200}>
          <Typography variant="h6" sx={styles.subtitle}>
            还在为下载学生上传的大量压缩包而苦恼？
            <br />
            SJTU Canvas Helper 基于 Tauri 开发，助您更便捷地使用交大 Canvas
          </Typography>
        </ScrollReveal>

        <ScrollReveal delay={300}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={styles.btnRow}>
            <Button
              variant="contained"
              size="large"
              startIcon={<DownloadIcon />}
              href="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/releases"
              target="_blank"
              sx={styles.cta}
            >
              立即下载
            </Button>
            <Button
              variant="outlined"
              size="large"
              startIcon={<GitHubIcon />}
              href="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper"
              target="_blank"
              sx={styles.cta}
            >
              GitHub
            </Button>
          </Stack>
        </ScrollReveal>

        {/* Feature badges row */}
        <ScrollReveal delay={350}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 5, flexWrap: "wrap", gap: 1, justifyContent: "center" }}
          >
            {["📂 文件预览", "🗜️ 压缩包浏览", "☁️ 一键上传云盘", "📅 DDL 日历", "🎬 录屏处理", "🤖 AI / MCP"].map(
              (label) => (
                <Chip
                  key={label}
                  label={label}
                  variant="outlined"
                  size="small"
                  sx={{
                    fontWeight: 500,
                    borderColor: "primary.light",
                    color: "primary.dark",
                    bgcolor: "rgba(26,115,232,0.04)",
                    "&:hover": { bgcolor: "rgba(26,115,232,0.1)" },
                  }}
                />
              )
            )}
          </Stack>
        </ScrollReveal>

        <ScrollReveal delay={400}>
          <Stack direction="row" spacing={4} sx={styles.statRow}>
            {[
              ["⭐ 2k+", "GitHub Stars"],
              ["📥 10k+", "总下载量"],
              ["⚡ 实时", "文件预览"],
              ["☁️ 一键上传", "交大云盘"],
            ].map(([num, label]) => (
              <Box key={label} sx={{ textAlign: "center" }}>
                <Typography variant="h5" sx={{ fontWeight: 700, color: "primary.main" }}>
                  {num}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {label}
                </Typography>
              </Box>
            ))}
          </Stack>
        </ScrollReveal>
      </Container>
    </Box>
  )
}
