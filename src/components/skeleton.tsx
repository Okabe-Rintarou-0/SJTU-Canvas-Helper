import { Box, Skeleton, Stack } from "@mui/material";

export function TableSkeleton({
  rows = 6,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <Box sx={{ p: 2 }}>
      <Stack spacing={2.25}>
        {Array.from({ length: rows }).map((_, r) => (
          <Stack
            key={r}
            direction="row"
            spacing={2}
            alignItems="center"
            sx={{ px: 1 }}
          >
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={c}
                variant="text"
                width={`${Math.max(35, 100 - c * 18)}%`}
                sx={{ fontSize: 22, flex: 1 }}
              />
            ))}
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

export function ListSkeleton({ items = 3 }: { items?: number }) {
  return (
    <Stack spacing={2}>
      {Array.from({ length: items }).map((_, i) => (
        <Skeleton
          key={i}
          variant="rounded"
          height={116}
          sx={{ borderRadius: "16px" }}
        />
      ))}
    </Stack>
  );
}
