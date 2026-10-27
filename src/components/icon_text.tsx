import { Box, ButtonBase, Typography } from "@mui/material";
import { ReactNode } from "react";

import styles from "../css/icon_text.module.css";

export default function IconText({
  icon,
  text,
  selected,
  onClick,
  onDoubleClick,
  onHover,
  onLeaveHover,
}: {
  icon: ReactNode;
  text: ReactNode;
  selected: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onHover?: () => void;
  onLeaveHover?: () => void;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={onHover}
      onMouseLeave={onLeaveHover}
      sx={{
        width: 160,
        height: 100,
        borderRadius: "22px",
        border: "1px solid",
        borderColor: selected ? "primary.main" : "divider",
        bgcolor: selected ? "action.selected" : "background.paper",
        px: 2,
        py: 1.5,
        justifyContent: "center",
      }}
    >
      <Box sx={{ width: "100%" }}>
        <Box sx={{ display: "grid", placeItems: "center", mb: 1 }}>{icon}</Box>
        <Typography variant="body2" className={styles.text}>
          {text}
        </Typography>
      </Box>
    </ButtonBase>
  );
}
