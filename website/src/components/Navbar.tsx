import { AppBar, Toolbar, Button, Box, Container, Typography, IconButton } from "@mui/material"
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome"
import GitHubIcon from "@mui/icons-material/GitHub"
import MenuIcon from "@mui/icons-material/Menu"
import { useState } from "react"

const sections = [
  { label: "功能特性", id: "features" },
  { label: "快速预览", id: "preview" },
  { label: "交大云盘", id: "jbox" },
] as const

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })
    setMobileOpen(false)
  }

  return (
    <>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          bgcolor: "rgba(255,255,255,0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Container maxWidth="lg">
          <Toolbar disableGutters sx={{ gap: 1 }}>
            <AutoAwesomeIcon sx={{ color: "primary.main", fontSize: 28 }} />
            <Typography
              variant="h6"
              sx={{
                fontWeight: 700,
                color: "text.primary",
                cursor: "pointer",
                flexGrow: { xs: 1, md: 0 },
                mr: { md: 6 },
                whiteSpace: "nowrap",
              }}
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            >
              SJTU Canvas Helper
            </Typography>

            <Box sx={{ display: { xs: "none", md: "flex" }, gap: 1, flexGrow: 1 }}>
              {sections.map((s) => (
                <Button
                  key={s.id}
                  onClick={() => scrollTo(s.id)}
                  sx={{ color: "text.secondary", fontWeight: 500 }}
                >
                  {s.label}
                </Button>
              ))}
            </Box>

            <Box sx={{ display: { xs: "none", md: "flex" }, gap: 1 }}>
              <IconButton
                href="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper"
                target="_blank"
                color="inherit"
              >
                <GitHubIcon />
              </IconButton>
              <Button
                variant="contained"
                startIcon={<GitHubIcon />}
                href="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/releases"
                target="_blank"
                sx={{
                  borderRadius: "10px",
                  fontWeight: 600,
                }}
              >
                免费下载
              </Button>
            </Box>

            <IconButton
              sx={{ display: { md: "none" } }}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <MenuIcon />
            </IconButton>
          </Toolbar>
        </Container>
      </AppBar>

      {mobileOpen && (
        <Box
          sx={{
            position: "fixed",
            top: 64,
            left: 0,
            right: 0,
            bgcolor: "background.paper",
            zIndex: 1200,
            borderBottom: "1px solid",
            borderColor: "divider",
            display: { md: "none" },
            p: 2,
          }}
        >
          {sections.map((s) => (
            <Button
              key={s.id}
              fullWidth
              onClick={() => scrollTo(s.id)}
              sx={{ justifyContent: "flex-start", py: 1 }}
            >
              {s.label}
            </Button>
          ))}
          <Button
            fullWidth
            variant="contained"
            href="https://github.com/Okabe-Rintarou-0/SJTU-Canvas-Helper/releases"
            target="_blank"
            sx={{ mt: 1, fontWeight: 600 }}
          >
            免费下载
          </Button>
        </Box>
      )}
    </>
  )
}
