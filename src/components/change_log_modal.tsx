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
            <Title level={4}>v1.3.5 2024/5/16</Title>
            <Paragraph>
                <ul>
                    <li>[Fix] 修复老师无法正常使用批改作业功能的 bug。</li>
                    <li>[Fix] 修复课程无老师时无法正确显示的 bug。</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.4 2024/5/15</Title>
            <Paragraph>
                <ul>
                    <li>[Feature] 新增成绩册页面，支持多种视图、导出成绩为 excel 表格。</li>
                </ul>
            </Paragraph>
            <Title level={4}>v1.3.3 2024/5/11</Title>
            <Paragraph>
                <ul>
                    <li>[Feature] 可以给课程的作业绑定（支持多个）文件，便于预览作业要求。</li>
                </ul>
            </Paragraph>
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