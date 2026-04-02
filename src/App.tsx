import { CssBaseline, GlobalStyles } from "@mui/material";
import { alpha, createTheme, ThemeProvider } from "@mui/material/styles";
import { useMemo } from "react";

import AppRouter from "./components/router";
import "./css/global.css";
import { useConfigSelector } from "./lib/hooks";
import { AppMessageProvider } from "./lib/message";

function App() {
  const config = useConfigSelector((state) => state.config.data);

  const muiTheme = useMemo(() => {
    const mode = config?.theme === "dark" ? "dark" : "light";
    const primary = config?.color_primary ?? "#00b96b";

    return createTheme({
      palette: {
        mode,
        primary: {
          main: primary,
        },
        secondary: {
          main: "#2563eb",
        },
        background:
          mode === "dark"
            ? {
                default: "#07111d",
                paper: "#0f1a2b",
              }
            : {
                default: "#f4f7fb",
                paper: "#ffffff",
              },
      },
      shape: {
        borderRadius: 20,
      },
      typography: {
        fontFamily:
          '"SF Pro Display", "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif',
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              background:
                mode === "dark"
                  ? "radial-gradient(circle at top left, rgba(37,99,235,0.16), transparent 28%), #07111d"
                  : "radial-gradient(circle at top left, rgba(37,99,235,0.08), transparent 24%), #f4f7fb",
            },
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: {
              backgroundImage: "none",
            },
          },
        },
        MuiCard: {
          styleOverrides: {
            root: {
              backgroundImage: "none",
            },
          },
        },
        MuiButton: {
          styleOverrides: {
            root: {
              borderRadius: 999,
              textTransform: "none",
            },
          },
        },
      },
    });
  }, [config?.color_primary, config?.theme]);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline enableColorScheme />
      <GlobalStyles
        styles={{
          "::selection": {
            backgroundColor: alpha(muiTheme.palette.primary.main, 0.22),
          },
        }}
      />
      <AppMessageProvider>
        <AppRouter />
      </AppMessageProvider>
    </ThemeProvider>
  );
}

export default App;
