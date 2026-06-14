import { Box, Container, Typography, Stack, IconButton, Button, Divider, Dialog, DialogContent } from "@mui/material"
import GitHubIcon from "@mui/icons-material/GitHub"
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome"
import CoffeeIcon from "@mui/icons-material/Coffee"
import CloseIcon from "@mui/icons-material/Close"
import { useState } from "react"
import ScrollReveal from "./ScrollReveal"

const BASE = import.meta.env.BASE_URL

export default function FooterSection() {
  const [coffeeOpen, setCoffeeOpen] = useState(false)

  return (
    <>
      <Box
        id="footer"
        sx={{
          py: { xs: 6, md: 8 },
          bgcolor: "#0d1117",
          color: "#c9d1d9",
        }}
      >
        <Container maxWidth="lg">
          <ScrollReveal>
            <Stack spacing={3} sx={{ alignItems: "center", textAlign: "center" }}>
              <AutoAwesomeIcon sx={{ fontSize: 36, color: "#58a6ff" }} />

              <Typography variant="h5" sx={{ fontWeight: 700, color: "#fff" }}>
                SJTU Canvas Helper
              </Typography>

              <Typography
                variant="body1"
                sx={{ maxWidth: 500, color: "#8b949e", lineHeight: 1.6 }}
              >
                让交大 Canvas 更好用 — 开源、免费、跨平台的 Canvas 桌面助手
              </Typography>

              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", justifyContent: "center" }}>
                <IconButton
                  href="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper"
                  target="_blank"
                  sx={{ color: "#8b949e", "&:hover": { color: "#fff" } }}
                >
                  <GitHubIcon />
                </IconButton>
                <Button
                  variant="outlined"
                  href="https://shuiyuan.sjtu.edu.cn/t/topic/245275"
                  target="_blank"
                  sx={{ borderColor: "#30363d", color: "#8b949e" }}
                >
                  💬 水源社区讨论
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<CoffeeIcon />}
                  onClick={() => setCoffeeOpen(true)}
                  sx={{ borderColor: "#30363d", color: "#8b949e" }}
                >
                  请作者喝咖啡
                </Button>
                <Button
                  variant="outlined"
                  href="https://deepwiki.com/Okabe-Rintarou-0/SJTU-Canvas-Helper"
                  target="_blank"
                  sx={{ borderColor: "#30363d", color: "#8b949e" }}
                >
                  📖 DeepWiki
                </Button>
              </Stack>

              <Divider sx={{ width: "100%", borderColor: "#21262d" }} />

              <Typography variant="body2" sx={{ color: "#484f58" }}>
                Built with ❤️ for SJTU · {new Date().getFullYear()}
              </Typography>
            </Stack>
          </ScrollReveal>
        </Container>
      </Box>

      {/* Coffee QR Dialog */}
      <Dialog
        open={coffeeOpen}
        onClose={() => setCoffeeOpen(false)}
        maxWidth="xs"
        slotProps={{
          paper: {
            sx: {
              borderRadius: "20px",
              textAlign: "center",
            },
          },
        }}
      >
        <IconButton
          onClick={() => setCoffeeOpen(false)}
          sx={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}
        >
          <CloseIcon />
        </IconButton>
        <DialogContent sx={{ px: 5, pt: 5, pb: 4 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
            请作者喝杯咖啡 ☕
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            如果这个工具帮到了你，欢迎请作者喝杯咖啡～
          </Typography>
          <Box
            component="img"
            src={`${BASE}coffee.jpg`}
            alt="收款码"
            sx={{
              width: "100%",
              maxWidth: 280,
              height: "auto",
              borderRadius: "12px",
              mx: "auto",
              display: "block",
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
