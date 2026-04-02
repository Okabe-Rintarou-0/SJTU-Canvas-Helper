import DescriptionRoundedIcon from "@mui/icons-material/DescriptionRounded";
import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { ReactNode } from "react";

export default function RendererShell({
  title,
  subtitle,
  fileType,
  icon,
  actions,
  children,
  contentSx,
}: {
  title: string;
  subtitle?: string;
  fileType?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  contentSx?: object;
}) {
  const theme = useTheme();

  return (
    <Card
      sx={{
        width: "100%",
        height: "100%",
        borderRadius: "24px",
        border: "1px solid",
        borderColor: "divider",
        backgroundImage: "none",
        boxShadow: "none",
        overflow: "hidden",
      }}
    >
      <CardContent sx={{ p: 0, height: "100%" }}>
        <Box
          sx={{
            px: 2.25,
            py: 1.75,
            borderBottom: "1px solid",
            borderColor: "divider",
            background:
              theme.palette.mode === "dark"
                ? `linear-gradient(135deg, ${alpha(
                    theme.palette.primary.main,
                    0.12
                  )}, ${alpha("#0f172a", 0.92)})`
                : `linear-gradient(135deg, ${alpha(
                    theme.palette.primary.main,
                    0.08
                  )}, rgba(255,255,255,0.94))`,
          }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            spacing={1.5}
          >
            <Stack direction="row" spacing={1.25} alignItems="center" minWidth={0}>
              <Box
                sx={{
                  width: 42,
                  height: 42,
                  borderRadius: "14px",
                  display: "grid",
                  placeItems: "center",
                  bgcolor: alpha(theme.palette.primary.main, 0.12),
                  color: "primary.main",
                  flexShrink: 0,
                }}
              >
                {icon ?? <DescriptionRoundedIcon />}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="subtitle1"
                  sx={{
                    fontWeight: 800,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {title}
                </Typography>
                {subtitle ? (
                  <Typography variant="caption" color="text.secondary">
                    {subtitle}
                  </Typography>
                ) : null}
              </Box>
            </Stack>

            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
              justifyContent={{ xs: "flex-start", sm: "flex-end" }}
            >
              {fileType ? (
                <Chip
                  size="small"
                  label={fileType.toUpperCase()}
                  color="primary"
                  variant="outlined"
                />
              ) : null}
              {actions}
            </Stack>
          </Stack>
        </Box>

        <Box
          sx={{
            p: 2,
            height: "calc(100% - 78px)",
            overflow: "auto",
            ...contentSx,
          }}
        >
          {children}
        </Box>
      </CardContent>
    </Card>
  );
}
