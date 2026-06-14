import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider, createTheme, CssBaseline } from "@mui/material"
import HomePage from "./pages/HomePage"
import "./index.css"

const theme = createTheme({
  palette: {
    primary: { main: "#1a73e8" },
    secondary: { main: "#e8451a" },
  },
  typography: {
    fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
    h1: { fontWeight: 800 },
    h2: { fontWeight: 700 },
    h3: { fontWeight: 700 },
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <HomePage />
    </ThemeProvider>
  </StrictMode>
)
