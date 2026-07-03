import { Card, CardProps } from "@mui/material";
import { surfaceCardSx } from "../lib/styles";

export function SurfaceCard({ sx, ...props }: CardProps) {
  return <Card sx={{ ...surfaceCardSx, ...sx } as CardProps["sx"]} {...props} />;
}
