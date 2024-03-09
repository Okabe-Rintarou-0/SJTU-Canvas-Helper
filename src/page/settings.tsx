import { Button, Form, Input, InputNumber, Space } from "antd";
import BasicLayout from "../components/layout";
import { useEffect } from "react";
import { AppConfig } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import useMessage from "antd/es/message/useMessage";
import { getConfig, saveConfig } from "../lib/store";

const { Password } = Input;

export default function SettingsPage() {
    const [form] = Form.useForm<AppConfig>();
    const [messageApi, contextHolder] = useMessage();

    useEffect(() => {
        initConfig();
    }, []);

    const initConfig = async () => {
        let config = await getConfig();
        form.setFieldsValue(config);
    }

    const handleSaveConfig = async (config: AppConfig) => {
        try {
            await saveConfig(config);
            messageApi.success("保存成功！");
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const savePathValidator = async (_: any, savePath: string) => {
        let valid = await invoke("check_path", { path: savePath });
        return valid ? Promise.resolve() : Promise.reject(new Error("保存路径无效！请检查目录是否存在！"));
    }

    const proxyPortValidator = async (_: any, port: number) => {
        // 0---65535
        const valid = 0 <= port && port <= 65535;
        return valid ? Promise.resolve() : Promise.reject(new Error("端口必须是 0 - 65535 之间的数字"));
    }

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical" style={{ width: "100%" }}>
            <Form
                form={form}
                layout="vertical"
                onFinish={handleSaveConfig}
                preserve={false}
            >
                <Form.Item
                    name="token"
                    label="Token"
                    required
                    style={{ margin: "0px" }}
                >
                    <Password placeholder="请输入 Canvas Token" />
                </Form.Item>
                <p>请进入 <a href="https://oc.sjtu.edu.cn/profile/settings" target="_blank">https://oc.sjtu.edu.cn/profile/settings</a> 创建你的 API Token</p>
                <Form.Item name="save_path" label="下载保存目录" required rules={[{ validator: savePathValidator }]}>
                    <Input placeholder="请输入文件下载保存目录" />
                </Form.Item>
                <Form.Item name="proxy_port" label="反向代理本地端口" rules={[{ validator: proxyPortValidator }]}>
                    <InputNumber placeholder="请输入反向代理本地端口" />
                </Form.Item>
                <Form.Item name="serve_as_plaintext" label="以纯文本显示的文件拓展名">
                    <Input placeholder="请输入文件拓展名，以英文逗号隔开" />
                </Form.Item>
                <Form.Item>
                    <Button type="primary" htmlType="submit">
                        保存
                    </Button>
                </Form.Item>
            </Form>
        </Space>
    </BasicLayout>
}