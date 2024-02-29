import { Progress, Space, Table } from "antd";
import { FileDownloadTask } from "../lib/model";

export default function FileDownloadTable({
    tasks,
    handleRemoveTask
}: {
    tasks: FileDownloadTask[],
    handleRemoveTask?: (task: FileDownloadTask) => void,
}) {
    const columns = [
        {
            title: '文件名',
            dataIndex: 'file',
            key: 'file',
            render: (_: any, task: FileDownloadTask) => task.file.display_name
        },
        {
            title: '进度条',
            dataIndex: 'progress',
            render: (_: any, task: FileDownloadTask) => <Progress percent={task.progress} />
        },
        {
            title: '操作',
            dataIndex: 'operation',
            key: 'operation',
            render: (_: any, task: FileDownloadTask) => (
                <Space size="middle">
                    <a onClick={e => {
                        e.preventDefault();
                        handleRemoveTask?.(task);
                    }}>删除</a>
                </Space>
            ),
        }
    ];
    return <Table style={{ width: "100%" }} columns={columns} dataSource={tasks} />
}