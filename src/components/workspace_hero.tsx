import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import type { CSSProperties, ReactElement, ReactNode } from "react";

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
  return (
    <Card className="card-lift" sx={{ borderColor: "divider" }}>
      <CardContent sx={{ p: { xs: 2.5, md: 3 } }}>
        <Stack spacing={2.5}>
          <Stack
            direction={{ xs: "column", lg: "row" }}
            justifyContent="space-between"
            spacing={2}
            alignItems={{ xs: "stretch", lg: "flex-start" }}
          >
            <Stack spacing={0.75} className="rise" sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={0.75} alignItems="center">
                {chipIcon ? (
                  <Box
                    sx={{
                      display: "grid",
                      placeItems: "center",
                      color: "primary.main",
                      "& svg": { fontSize: 15 },
                    }}
                  >
                    {chipIcon}
                  </Box>
                ) : (
                  <Box
                    sx={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      bgcolor: "primary.main",
                      flexShrink: 0,
                    }}
                  />
                )}
                <Typography variant="caption" sx={{ fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {chipLabel}
                </Typography>
              </Stack>
              <Typography variant="h4" sx={{ fontWeight: 600 }}>
                {title}
              </Typography>
              {description ? (
                <Typography variant="body2" color="text.secondary">
                  {description}
                </Typography>
              ) : null}
            </Stack>

            {aside ? (
              <Box
                className="rise"
                style={{ "--rise-delay": "60ms" } as CSSProperties}
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
              className="rise"
              style={{ "--rise-delay": "120ms" } as CSSProperties}
              sx={{
                display: "flex",
                flexWrap: "wrap",
                gap: { xs: 2, md: 4 },
                alignItems: "flex-end",
                px: { xs: 0.5, md: 1 },
                py: 1.5,
                borderRadius: "12px",
                bgcolor: (theme) =>
                  theme.palette.mode === "dark"
                    ? "rgba(255,255,255,0.03)"
                    : "rgba(31, 42, 36, 0.025)",
              }}
            >
              {stats.map((item, index) => (
                <Stack
                  key={String(item.label)}
                  spacing={0.25}
                  sx={{
                    minWidth: 88,
                    pl: { xs: 1.5, md: 2.5 },
                    ...(index > 0
                      ? {
                          borderLeft: { md: "1px solid" },
                          borderColor: "divider",
                        }
                      : {}),
                  }}
                >
                  <Typography variant="overline" color="text.secondary">
                    {item.label}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    {item.icon ? (
                      <Box
                        sx={{
                          display: "grid",
                          placeItems: "center",
                          color: "primary.main",
                          "& svg": { fontSize: 18 },
                        }}
                      >
                        {item.icon}
                      </Box>
                    ) : null}
                    <Typography
                      variant="h6"
                      sx={{ fontWeight: 600, wordBreak: "break-word" }}
                    >
                      {item.value}
                    </Typography>
                  </Stack>
                </Stack>
              ))}
            </Box>
          ) : null}

          {footer ? <Box className="rise" style={{ "--rise-delay": "180ms" } as CSSProperties}>{footer}</Box> : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
