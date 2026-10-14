import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import {
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  TextFieldProps,
} from "@mui/material";
import { open } from "@tauri-apps/plugin-dialog";
import React, { useEffect, useState } from "react";

import { getConfig } from "../lib/config";

interface PathSelectorProps {
  value?: string;
  onChange?: (value: string) => void;
  directory?: boolean;
  extensions?: string[];
  placeholder?: string;
}

const DEFAULT_PLACE_HOLDER = "请输入文件下载保存目录";

export const PathSelector = React.forwardRef<HTMLInputElement, PathSelectorProps>(
  (
    {
      value,
      onChange,
      extensions,
      directory = true,
      placeholder = DEFAULT_PLACE_HOLDER,
    },
    ref
  ) => {
    const [saveDir, setSaveDir] = useState<string>("");

    useEffect(() => {
      setSaveDir(value ?? "");
    }, [value]);

    const handleSelectDirectory = async () => {
      const config = await getConfig(true);
      const path = config.save_path.length > 0 ? config.save_path : undefined;
      const selected = await open({
        directory,
        defaultPath: path,
        filters: extensions ? [{ name: "", extensions }] : undefined,
      });

      if (!selected) {
        return;
      }

      const nextValue = Array.isArray(selected) ? selected[0] : selected;
      if (nextValue) {
        setSaveDir(nextValue);
        onChange?.(nextValue);
      }
    };

    const inputProps: TextFieldProps["InputProps"] = {
      endAdornment: (
        <InputAdornment position="end">
          <IconButton edge="end" onClick={handleSelectDirectory}>
            <FolderOpenRoundedIcon />
          </IconButton>
        </InputAdornment>
      ),
    };

    return (
      <Stack sx={{ width: "100%" }}>
        <TextField
          inputRef={ref}
          fullWidth
          value={saveDir}
          placeholder={placeholder}
          onChange={(event) => {
            const nextValue = event.target.value;
            setSaveDir(nextValue);
            onChange?.(nextValue);
          }}
          InputProps={inputProps}
        />
      </Stack>
    );
  }
);

PathSelector.displayName = "PathSelector";
