import { Modal, Typography } from "antd";
import Paragraph from "antd/es/typography/Paragraph";
import Title from "antd/es/typography/Title";
export function ChangeLogModal({ open, onCancel, onOk }: {
    open: boolean
    onCancel: () => void,
    onOk: () => void,
}) {
    return <Modal title="更新日志" open={open} footer={null} onCancel={onCancel} onOk={onOk} style={{
        maxHeight: "80%",
        overflow: "scroll",
    }}>
        <Typography>
            <Title level={4}>v1.3.2 2024/5/10</Title>
            <Paragraph>
                <ul>
                    <li>[Fix] 修复了主副屏播放速度不同步的问题。即修改主屏幕播放速度，副屏的播放速度没有被同步修改。</li>
                    <li>[Feature] 新增 CHANGE LOG 板块，便于用户查看更新内容。</li>
                </ul>
            </Paragraph>
        </Typography>
    </Modal>
}