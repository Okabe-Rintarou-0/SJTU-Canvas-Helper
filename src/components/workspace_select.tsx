import { TextField, type TextFieldProps } from "@mui/material";
import { useWorkspacePopup } from "../lib/workspace_activity";

export default function WorkspaceSelect(props: TextFieldProps) {
  const popup = useWorkspacePopup();
  return <TextField {...props} select SelectProps={{ ...props.SelectProps, ...popup }} />;
}
