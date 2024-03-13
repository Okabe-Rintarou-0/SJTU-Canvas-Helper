import { Modal } from "antd";
import { LoginAlert } from "./login_alert";
import { useQRCode } from "../lib/hooks";
import { useEffect } from "react";

export function LoginAlertModal({ open, onCancelLogin, onLogin }: {
    open: boolean,
    onCancelLogin?: () => void,
    onLogin?: () => void,
}) {
    useEffect(() => {
        showQRCode();
    }, []);

    const { qrcode, showQRCode, refreshQRCode } = useQRCode({ onScanSuccess: onLogin });
    return <Modal open={open} footer={null} onCancel={onCancelLogin}>
        <LoginAlert qrcode={qrcode} refreshQRCode={refreshQRCode} />
    </Modal>
}