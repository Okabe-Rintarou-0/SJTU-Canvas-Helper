import { Alert, Button, QRCode, Space } from "antd";

export function LoginAlert({ qrcode, refreshQRCode }: {
    qrcode: string,
    refreshQRCode: () => void
}) {
    return <Alert type="warning" showIcon message={"检测到您未登录🙅！您需要登录以继续使用该功能😁"} description={<Space direction="vertical">
        <QRCode size={250} value={qrcode} />
        <Button onClick={refreshQRCode}>刷新</Button>
    </Space>
    } />
}