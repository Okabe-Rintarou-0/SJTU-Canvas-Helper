import { CssBaseline, GlobalStyles } from "@mui/material";
import { alpha, createTheme, ThemeProvider } from "@mui/material/styles";
import { useMemo } from "react";

import AppRouter from "./components/router";
import "./css/global.css";
import { useConfigSelector } from "./lib/hooks";
import { AppMessageProvider } from "./lib/message";

const FONT_DISPLAY =
  '"Iowan Old Style", "Palatino Linotype", "Georgia", "STZhongsong", "SimSun", "Songti SC", serif';
const FONT_BODY =
  '"Aptos", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

function App() {
  const config = useConfigSelector((state) => state.config.data);

  const muiTheme = useMemo(() => {
    const mode = config?.theme === "dark" ? "dark" : "light";
    const primary = config?.color_primary ?? "#00b96b";

    const divider =
      mode === "dark" ? "rgba(232, 234, 240, 0.1)" : "rgba(38, 40, 46, 0.1)";
    const textPrimary = mode === "dark" ? "#ece8e1" : "#27282e";
    const textSecondary = mode === "dark" ? "#9aa1ad" : "#66636b";
    const hoverFill =
      mode === "dark" ? "rgba(255,255,255,0.05)" : "rgba(38,40,46,0.045)";

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
                default: "#11141a",
                paper: "#1a1f28",
              }
            : {
                default: "#f2efe6",
                paper: "#fffdf8",
              },
        text: {
          primary: textPrimary,
          secondary: textSecondary,
        },
        divider,
        action: {
          hover: hoverFill,
          selected: mode === "dark" ? alpha(primary, 0.18) : alpha(primary, 0.09),
        },
      },
      shape: {
        borderRadius: 16,
      },
      typography: {
        fontFamily: FONT_BODY,
        h1: {
          fontFamily: FONT_DISPLAY,
          fontSize: 40,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.12,
        },
        h2: {
          fontFamily: FONT_DISPLAY,
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          lineHeight: 1.15,
        },
        h3: {
          fontFamily: FONT_DISPLAY,
          fontSize: 27,
          fontWeight: 700,
          letterSpacing: "-0.015em",
          lineHeight: 1.18,
        },
        h4: {
          fontFamily: FONT_DISPLAY,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          lineHeight: 1.2,
        },
        h5: {
          fontFamily: FONT_DISPLAY,
          fontSize: 19,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          lineHeight: 1.25,
        },
        h6: {
          fontFamily: FONT_DISPLAY,
          fontSize: 16.5,
          fontWeight: 700,
          letterSpacing: "-0.005em",
          lineHeight: 1.3,
        },
        subtitle1: {
          fontSize: 16,
          fontWeight: 600,
          lineHeight: 1.45,
        },
        subtitle2: {
          fontSize: 14.5,
          fontWeight: 600,
          lineHeight: 1.45,
        },
        body1: {
          fontSize: 15,
          lineHeight: 1.6,
        },
        body2: {
          fontSize: 13.5,
          lineHeight: 1.55,
        },
        caption: {
          fontSize: 12,
          letterSpacing: "0.02em",
          lineHeight: 1.4,
        },
        overline: {
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          lineHeight: 1.5,
        },
        button: {
          fontWeight: 600,
          letterSpacing: "0.01em",
        },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              backgroundColor: mode === "dark" ? "#11141a" : "#f2efe6",
              backgroundImage: `radial-gradient(1100px 560px at 12% -8%, ${
                mode === "dark" ? alpha(primary, 0.1) : alpha(primary, 0.055)
              }, transparent 62%)`,
              color: textPrimary,
              WebkitFontSmoothing: "antialiased",
              MozOsxFontSmoothing: "grayscale",
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
              borderRadius: 16,
              border: `1px solid ${divider}`,
              boxShadow:
                mode === "dark"
                  ? "inset 0 1px 0 rgba(255,255,255,0.03)"
                  : "0 1px 2px rgba(28, 30, 36, 0.04)",
            },
          },
        },
        MuiButton: {
          styleOverrides: {
            root: {
              borderRadius: 999,
              textTransform: "none",
              fontWeight: 600,
            },
            contained: {
              boxShadow: "none",
              "&:hover": {
                boxShadow: "none",
              },
            },
            containedPrimary: {
              color: mode === "dark" ? "#11141a" : "#fffdf8",
              backgroundColor: mode === "dark" ? "#ece9e2" : "#24272d",
              "&:hover": {
                backgroundColor: mode === "dark" ? "#f8f5ef" : "#15171b",
              },
            },
          },
        },
        MuiChip: {
          styleOverrides: {
            root: {
              borderRadius: 8,
              fontWeight: 500,
            },
          },
        },
        MuiListItemButton: {
          styleOverrides: {
            root: {
              borderRadius: 10,
              "&:hover": {
                backgroundColor: hoverFill,
              },
            },
          },
        },
        MuiTableCell: {
          styleOverrides: {
            root: {
              borderBottom: `1px solid ${divider}`,
              paddingTop: 12,
              paddingBottom: 12,
            },
            head: {
              fontWeight: 700,
              color: textSecondary,
              fontSize: 12,
              letterSpacing: "0.04em",
              backgroundColor:
                mode === "dark" ? "rgba(255,255,255,0.02)" : "rgba(38,40,46,0.015)",
            },
          },
        },
        MuiTableRow: {
          styleOverrides: {
            root: {
              "&.MuiTableRow-hover:hover": {
                backgroundColor:
                  mode === "dark" ? "rgba(255,255,255,0.025)" : "rgba(38,40,46,0.02)",
              },
            },
          },
        },
        MuiTabs: {
          styleOverrides: {
            indicator: {
              height: 3,
              borderRadius: 999,
            },
          },
        },
        MuiTab: {
          styleOverrides: {
            root: {
              textTransform: "none",
              fontWeight: 600,
              minHeight: 44,
            },
          },
        },
        MuiOutlinedInput: {
          styleOverrides: {
            root: {
              borderRadius: 12,
            },
          },
        },
        MuiDialog: {
          styleOverrides: {
            paper: {
              borderRadius: 18,
              border: `1px solid ${divider}`,
              backgroundImage: "none",
            },
          },
        },
        MuiMenu: {
          styleOverrides: {
            paper: {
              borderRadius: 12,
              backgroundImage: "none",
            },
          },
        },
        MuiTooltip: {
          styleOverrides: {
            tooltip: {
              borderRadius: 8,
              fontSize: 12,
            },
          },
        },
        MuiAlert: {
          styleOverrides: {
            root: {
              borderRadius: 12,
            },
          },
        },
        MuiSkeleton: {
          styleOverrides: {
            root: {
              borderRadius: 8,
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
            backgroundColor: alpha(muiTheme.palette.primary.main, 0.24),
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
