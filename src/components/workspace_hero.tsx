import { Box, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import { ReactElement, ReactNode } from "react";

interface WorkspaceHeroStat {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
}

interface WorkspaceHeroProps {
  chipLabel: string;
  chipIcon?: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  stats?: WorkspaceHeroStat[];
  footer?: ReactNode;
}

export function WorkspaceHero({
  chipLabel,
  chipIcon,
  title,
  description,
  aside,
  stats,
  footer,
}: WorkspaceHeroProps) {
  const theme = useTheme();

  return (
    <Card
      sx={{
        borderRadius: "28px",
        border: "1px solid",
        borderColor: "divider",
        background:
          theme.palette.mode === "dark"
            ? `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.18)}, ${alpha(
                "#0f172a",
                0.9
              )})`
            : `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)}, rgba(255,255,255,0.96))`,
        boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08)",
      }}
    >
      <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
        <Stack spacing={3}>
          <Stack
            direction={{ xs: "column", lg: "row" }}
            justifyContent="space-between"
            spacing={2}
            alignItems={{ xs: "stretch", lg: "flex-start" }}
          >
            <Stack spacing={1} sx={{ minWidth: 0 }}>
              <Chip
                icon={chipIcon}
                label={chipLabel}
                color="primary"
                variant="outlined"
                sx={{ width: "fit-content" }}
              />
              <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: "-0.03em" }}>
                {title}
              </Typography>
              {description ? (
                <Typography variant="body1" color="text.secondary">
                  {description}
                </Typography>
              ) : null}
            </Stack>

            {aside ? (
              <Box
                sx={{
                  display: "flex",
                  justifyContent: { xs: "stretch", lg: "flex-end" },
                  alignItems: "flex-start",
                  alignSelf: { xs: "stretch", lg: "flex-start" },
                  flexShrink: 0,
                }}
              >
                {aside}
              </Box>
            ) : null}
          </Stack>

          {stats?.length ? (
            <Box
              sx={{
                display: "grid",
                gap: 2,
                gridTemplateColumns: {
                  xs: "repeat(2, minmax(0, 1fr))",
                  lg: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))`,
                },
              }}
            >
              {stats.map((item) => (
                <Card
                  key={String(item.label)}
                  sx={{
                    borderRadius: "22px",
                    backgroundColor: alpha(theme.palette.background.paper, 0.8),
                    border: "1px solid",
                    borderColor: alpha(theme.palette.divider, 0.5),
                    boxShadow: "none",
                  }}
                >
                  <CardContent sx={{ p: 2.25 }}>
                    {item.icon ? (
                      <Stack direction="row" spacing={1.5} alignItems="center">
                        <Box
                          sx={{
                            width: 46,
                            height: 46,
                            borderRadius: "16px",
                            display: "grid",
                            placeItems: "center",
                            bgcolor: alpha(theme.palette.primary.main, 0.12),
                            color: "primary.main",
                            "& svg": { fontSize: 24 },
                          }}
                        >
                          {item.icon}
                        </Box>
                        <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                          <Typography variant="body2" color="text.secondary">
                            {item.label}
                          </Typography>
                          <Typography
                            variant="h6"
                            sx={{ lineHeight: 1.2, wordBreak: "break-word" }}
                          >
                            {item.value}
                          </Typography>
                        </Stack>
                      </Stack>
                    ) : (
                      <>
                        <Typography variant="overline" color="text.secondary">
                          {item.label}
                        </Typography>
                        <Typography variant="h4" sx={{ fontWeight: 800, mt: 1 }}>
                          {item.value}
                        </Typography>
                      </>
                    )}
                  </CardContent>
                </Card>
              ))}
            </Box>
          ) : null}

          {footer ? footer : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
