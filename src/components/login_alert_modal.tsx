import { Dialog, DialogContent, DialogTitle } from "@mui/material";
import { useEffect } from "react";

import { useQRCode } from "../lib/hooks";
import { LoginAlert } from "./login_alert";

export function LoginAlertModal({
  open,
  onCancelLogin,
  onLogin,
}: {
  open: boolean;
  onCancelLogin?: () => void;
  onLogin?: () => void;
}) {
  const { qrcode, showQRCode, refreshQRCode } = useQRCode({ onScanSuccess: onLogin });

  useEffect(() => {
    if (open) {
      void showQRCode();
    }
  }, [open, showQRCode]);

  return (
    <Dialog open={open} onClose={onCancelLogin} fullWidth maxWidth="sm">
      <DialogTitle>登录验证</DialogTitle>
      <DialogContent>
        <LoginAlert qrcode={qrcode} refreshQRCode={refreshQRCode} />
      </DialogContent>
    </Dialog>
  );
}
