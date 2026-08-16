import { Box, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactElement, ReactNode } from "react";

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
    <Card
      sx={{
        borderRadius: "12px",
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <CardContent sx={{ p: { xs: 2.25, md: 2.75 } }}>
        <Stack spacing={2.25}>
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
                variant="outlined"
                sx={{ width: "fit-content" }}
              />
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
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
                <Box
                  key={String(item.label)}
                  sx={{
                    p: 2,
                    borderRadius: "10px",
                    border: "1px solid",
                    borderColor: "divider",
                    bgcolor: "background.paper",
                    transition:
                      "transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease",
                    "&:hover": {
                      transform: "translateY(-2px)",
                      boxShadow: (theme) => theme.shadows[2],
                      borderColor: (theme) =>
                        alpha(theme.palette.primary.main, 0.35),
                    },
                  }}
                >
                  {item.icon ? (
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Box
                        sx={{
                          width: 38,
                          height: 38,
                          borderRadius: "10px",
                          display: "grid",
                          placeItems: "center",
                          flexShrink: 0,
                          color: "primary.main",
                          bgcolor: (theme) =>
                            alpha(theme.palette.primary.main, 0.1),
                          "& svg": { fontSize: 20 },
                        }}
                      >
                        {item.icon}
                      </Box>
                      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                        <Typography variant="body2" color="text.secondary">
                          {item.label}
                        </Typography>
                        <Typography
                          variant="body1"
                          sx={{ fontWeight: 600, wordBreak: "break-word" }}
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
                      <Typography variant="h6" sx={{ fontWeight: 600, mt: 0.5 }}>
                        {item.value}
                      </Typography>
                    </>
                  )}
                </Box>
              ))}
            </Box>
          ) : null}

          {footer ? footer : null}
        </Stack>
      </CardContent>
    </Card>
  );
}
