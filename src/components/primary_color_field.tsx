import { Box, Button, InputAdornment, TextField } from "@mui/material";
import { useEffect, useRef, useState } from "react";

export const DEFAULT_PRIMARY = "#00b96b";

export default function PrimaryColorField({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;

    // React's onChange also fires for native input events while dragging.
    // Only the native change event commits the selection to the global theme.
    const commit = () => {
      if (picker.value !== value) onChange(picker.value);
    };
    picker.addEventListener("change", commit);
    return () => picker.removeEventListener("change", commit);
  }, [onChange, value]);

  return (
    <TextField size="small" fullWidth
      label="主色调"
      name="color_primary"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(event.target.value);
      }}
      placeholder="#00b96b"
      helperText="支持输入 Hex 颜色值；拖动选色时预览色值，选择完成后应用到工作区。"
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <Box
              style={{ backgroundColor: draft }}
              sx={{ width: 18, height: 18, borderRadius: "6px", border: "1px solid", borderColor: "divider" }}
            />
          </InputAdornment>
        ),
        endAdornment: (
          <InputAdornment position="end">
            <input
              ref={pickerRef}
              aria-label="选择主色"
              type="color"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={(event) => {
                if (event.target.value !== value) onChange(event.target.value);
              }}
              style={{ width: 28, height: 28, padding: 0, border: "none", background: "transparent", cursor: "pointer" }}
            />
            <Button size="small" aria-label="恢复默认主色调"
              onClick={() => {
                setDraft(DEFAULT_PRIMARY);
                if (value !== DEFAULT_PRIMARY) onChange(DEFAULT_PRIMARY);
              }}
              sx={{ ml: 1, whiteSpace: "nowrap" }}>
              恢复默认
            </Button>
          </InputAdornment>
        ),
      }}
    />
  );
}
