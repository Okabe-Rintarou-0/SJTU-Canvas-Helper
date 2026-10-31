import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import BuildOutlinedIcon from "@mui/icons-material/BuildOutlined";
import ManageAccountsOutlinedIcon from "@mui/icons-material/ManageAccountsOutlined";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import TuneRoundedIcon from "@mui/icons-material/TuneRounded";
import StorageRoundedIcon from "@mui/icons-material/StorageRounded";
import { Box, Button, Chip, Stack, Tab, Tabs, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useLayoutEffect, useRef, type PropsWithChildren } from "react";
import { WorkspaceHero } from "./workspace_hero";
import { surfaceCardSx } from "../lib/styles";

const sections = [
  { id: "account", label: "账号与连接", icon: <ManageAccountsOutlinedIcon /> },
  { id: "appearance", label: "界面偏好", icon: <PaletteOutlinedIcon /> },
  { id: "storage", label: "存储与数据", icon: <StorageRoundedIcon /> },
  { id: "ai", label: "AI 与模型", icon: <AutoAwesomeRoundedIcon /> },
  { id: "advanced", label: "高级与实验", icon: <TuneRoundedIcon /> },
  { id: "tools", label: "工具与诊断", icon: <BuildOutlinedIcon /> },
] as const;

export type SettingsSection = typeof sections[number]["id"];

export function SettingsPanel({ id, active, children }: PropsWithChildren<{ id: SettingsSection; active: SettingsSection }>) {
  return (
    <Box
      role="tabpanel"
      id={`settings-panel-${id}`}
      aria-labelledby={`settings-tab-${id}`}
      hidden={active !== id}
      tabIndex={0}
      sx={{
        display: active === id ? "block" : "none",
        minWidth: 0,
        "& > .MuiCard-root + .MuiCard-root": { mt: 2 },
      }}
    >
      {children}
    </Box>
  );
}

export default function SettingsShell({ active, onSectionChange, dirty, onSave, children }: PropsWithChildren<{
  active: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  dirty: boolean;
  onSave: () => void;
}>) {
  const navigationRef = useRef<HTMLDivElement>(null);
  const previousSection = useRef(active);
  useLayoutEffect(() => {
    if (previousSection.current !== active) {
      // Position the selected panel immediately when a long panel shrinks.
      // The app's smooth scrolling can otherwise race the document reflow.
      navigationRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
      previousSection.current = active;
    }
  }, [active]);

  return (
    <Stack spacing={2.5} sx={{ minWidth: 0 }}>
      <WorkspaceHero
        chipLabel="系统设置"
        chipIcon={<SettingsRoundedIcon />}
        title="系统设置"
        description="管理账号连接、界面偏好与 AI 服务。切换分类会保留当前修改。"
        aside={
          <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap">
            <Chip size="small" variant={dirty ? "filled" : "outlined"} color={dirty ? "warning" : "default"}
              sx={{ fontWeight: dirty ? 700 : 400 }}
              label={dirty ? "有未保存的修改" : "已与本地配置同步"} role="status" />
            <Button variant="contained" startIcon={<SaveRoundedIcon />} onClick={onSave}>保存全部设置</Button>
          </Stack>
        }
      />
      <Box ref={navigationRef} component="nav" aria-label="设置分类"
        sx={{ position: "sticky", top: 0, zIndex: 2, bgcolor: "background.paper", borderBottom: 1, borderColor: "divider", scrollMarginTop: 8 }}>
        <Tabs value={active} onChange={(_, value: SettingsSection) => onSectionChange(value)}
          variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile aria-label="设置分类">
          {sections.map((section) => (
            <Tab key={section.id} value={section.id} label={section.label} icon={section.icon} iconPosition="start"
              id={`settings-tab-${section.id}`} aria-controls={`settings-panel-${section.id}`} />
          ))}
        </Tabs>
      </Box>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
      <Stack direction="row" spacing={1.5} justifyContent="space-between" alignItems="center"
        sx={{ ...surfaceCardSx, position: "sticky", bottom: 0, zIndex: 3, px: 2, py: 1.25,
          bgcolor: "background.paper",
          backgroundImage: (theme) => dirty ? `linear-gradient(${alpha(theme.palette.warning.main, 0.14)}, ${alpha(theme.palette.warning.main, 0.14)})` : "none",
          borderColor: dirty ? "warning.main" : "divider", borderWidth: dirty ? 2 : 1 }}>
        <Typography variant="body2" color={dirty ? "text.primary" : "text.secondary"} fontWeight={dirty ? 700 : 400} role="status">{dirty ? "修改尚未保存" : "所有设置已同步"}</Typography>
        <Button variant="contained" color={dirty ? "warning" : "primary"} startIcon={<SaveRoundedIcon />} onClick={onSave}>保存全部设置</Button>
      </Stack>
    </Stack>
  );
}
