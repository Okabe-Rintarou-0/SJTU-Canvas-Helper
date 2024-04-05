import { Button, Form, Image, Input, InputNumber, Space, Tour } from "antd";
import BasicLayout from "../components/layout";
import { useEffect, useRef, useState } from "react";
import { AppConfig, User } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import useMessage from "antd/es/message/useMessage";
import { getConfig, saveConfig } from "../lib/store";

const { Password } = Input;
import type { InputRef, TourProps } from 'antd';

export default function SettingsPage() {
    const [form] = Form.useForm<AppConfig>();
    const [messageApi, contextHolder] = useMessage();
    const tokenRef = useRef<InputRef>(null);
    const savePathRef = useRef<InputRef>(null);
    const saveButtonRef = useRef(null);

    const [openTour, setOpenTour] = useState<boolean>(false);

    const steps: TourProps['steps'] = [
        {
            title: '填写您的 Canvas Token',
            description: <div>
                <p>请前往 <a href="https://oc.sjtu.edu.cn/profile/settings" target="_blank">https://oc.sjtu.edu.cn/profile/settings</a> 创建您的 API Token。</p>
                <Image src="help.png" width={"100%"} />
            </div>,
            target: () => tokenRef.current?.input!,
        },
        {
            title: '填写您的下载保存目录',
            description: '请正确填写您的下载保存目录。',
            target: () => savePathRef.current?.input!,
        },
        {
            title: '保存',
            description: '保存您的设置。',
            target: () => saveButtonRef.current,
        },
    ];

    useEffect(() => {
        initConfig();
    }, []);

    const initConfig = async () => {
        let config = await getConfig();
        form.setFieldsValue(config);
        if (config.token.length === 0) {
            setOpenTour(true);
        }
    }

    const handleSaveConfig = async (config: AppConfig) => {
        try {
            await saveConfig(config);
            messageApi.success("保存成功！");
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const handleTestToken = async () => {
        const token = form.getFieldValue("token")
        try {
            const me = await invoke("test_token", { token }) as User;
            messageApi.success(`👋你好，${me.name}。欢迎使用 SJTU Canvas Helper👏`, 2);
        } catch (e) {
            messageApi.error(`Token 无效🥹！`);
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
                    extra={<p>请前往 <a href="https://oc.sjtu.edu.cn/profile/settings" target="_blank">https://oc.sjtu.edu.cn/profile/settings</a> 创建您的 API Token</p>}
                    style={{ margin: "0px" }}
                >
                    <Password ref={tokenRef} placeholder="请输入 Canvas Token" />
                </Form.Item>
                <Form.Item name="save_path" label="下载保存目录" required rules={[{ validator: savePathValidator }]}>
                    <Input ref={savePathRef} placeholder="请输入文件下载保存目录" />
                </Form.Item>
                <Form.Item name="proxy_port" label="反向代理本地端口" rules={[{ validator: proxyPortValidator }]}>
                    <InputNumber placeholder="请输入反向代理本地端口" />
                </Form.Item>
                <Form.Item name="serve_as_plaintext" label="以纯文本显示的文件拓展名">
                    <Input placeholder="请输入文件拓展名，以英文逗号隔开" />
                </Form.Item>
                <Space>
                    <Form.Item>
                        <Button ref={saveButtonRef} type="primary" htmlType="submit">
                            保存
                        </Button>
                    </Form.Item>
                    <Form.Item>
                        <Button onClick={handleTestToken}>
                            测试 Token
                        </Button>
                    </Form.Item>
                </Space>
            </Form>
        </Space>
        {openTour && <Tour open={openTour} onClose={() => setOpenTour(false)} steps={steps} />}
    </BasicLayout>
}