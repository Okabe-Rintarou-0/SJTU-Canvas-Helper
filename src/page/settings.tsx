import { invoke } from "@tauri-apps/api";
import type { InputRef, TourProps } from 'antd';
import { Button, ColorPicker, Form, Image, Input, Select, Space, Tour } from "antd";
import useMessage from "antd/es/message/useMessage";
import { useEffect, useRef, useState } from "react";
import ReactJson from "react-json-view-ts";
import BasicLayout from "../components/layout";
import LogModal from "../components/log_modal";
import { PathSelector } from "../components/path_selector";
import { getConfig, saveConfig } from "../lib/config";
import { AccountInfo, AppConfig, LOG_LEVEL_INFO, User } from "../lib/model";
import { consoleLog, savePathValidator } from "../lib/utils";

const { Password } = Input;

type AccountMode = "create" | "select";

export default function SettingsPage() {
    const [form] = Form.useForm<AppConfig>();
    const [messageApi, contextHolder] = useMessage();
    const tokenRef = useRef<InputRef>(null);
    const savePathRef = useRef<InputRef>(null);
    const saveButtonRef = useRef(null);
    const createAccountInputRef = useRef<InputRef>(null);
    const [accounts, setAccounts] = useState<string[]>([]);
    const [openTour, setOpenTour] = useState<boolean>(false);
    const [accountMode, setAccountMode] = useState<AccountMode>("select");
    const [currentAccount, setCurrentAccount] = useState<string>("");
    const [rawConfig, setRawConfig] = useState<string>("");
    const [showLogModal, setShowLogModal] = useState<boolean>(false);

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

    const initAccounts = async () => {
        let accounts = await invoke("list_accounts") as string[];
        setAccounts(accounts);
    }

    const initConfig = async () => {
        try {
            await initAccounts();
            let config = await getConfig(true);
            let accountInfo = await invoke("read_account_info") as AccountInfo;
            setCurrentAccount(accountInfo.current_account);
            if (config.proxy_port === 0) {
                config.proxy_port = 3030;
            }
            form.setFieldsValue(config);
            consoleLog(LOG_LEVEL_INFO, "init config: ", config);
            if (config.token.length === 0) {
                setOpenTour(true);
            }
        } catch (e) {
            messageApi.error(`初始化时发生错误：${e}`);
        }
    }

    const handleSaveConfig = async (config: AppConfig) => {
        try {
            await saveConfig(config);
            messageApi.success("保存成功！");
            if (rawConfig) {
                await getRawConfig();
            }
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

    const handleTestApiKey = async () => {
        try {
            messageApi.open({
                key: "testing",
                type: "loading",
                content: "正在等待 LLM 答复😄...",
                duration: 0,
            })
            let resp = await invoke("chat", { prompt: "你好！" });
            messageApi.destroy("testing");
            messageApi.success(`来自 LLM 的回复：${resp}`);
        } catch (e) {
            messageApi.destroy("testing");
            messageApi.error(`API KEY 无效🥹！`);
        }
    }

    const handleOpenConfigDir = async () => {
        try {
            await invoke("open_config_dir");
        } catch (e) {
            messageApi.error(`打开失败🥹：${e}`);
        }
    }

    // const proxyPortValidator = async (_: any, port: number) => {
    //     // 0---65535
    //     const valid = 0 <= port && port <= 65535;
    //     return valid ? Promise.resolve() : Promise.reject(new Error("端口必须是 0 - 65535 之间的数字"));
    // }

    const handleCreateAccount = async () => {
        try {
            let account = createAccountInputRef.current?.input?.value;
            if (!account) {
                messageApi.warning("账号名不得为空⚠️！")
                return;
            }
            await invoke("create_account", { account });
            await initAccounts();
            setAccountMode("select");
            messageApi.success("创建账号成功🎉！")
        } catch (e) {
            messageApi.error(`创建账号失败：${e}`);
        }
    }

    const handleSwitchAccount = async (account: string) => {
        try {
            await invoke("switch_account", { account });
            initConfig();
            // messageApi.success("切换账号成功🎉！");
        } catch (e) {
            messageApi.error(`切换账号失败😢：${e}`);
        }
    }

    const handleDeleteAccount = async () => {
        try {
            await invoke("delete_account", { account: currentAccount });
            initConfig();
            messageApi.success("删除账号成功🎉！");
        } catch (e) {
            messageApi.error(`删除账号失败😢：${e}`);
        }
    }

    const getRawConfig = async () => {
        try {
            let rawConfig = await invoke("get_raw_config") as string;
            setRawConfig(rawConfig);
        } catch (e) {
            messageApi.error(`获取失败😢：${e}`);
        }
    }

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical" style={{ width: "100%" }}>
            {accountMode === "select" && < Space >
                <span>选择账号：</span>
                <Select
                    onChange={handleSwitchAccount}
                    style={{ width: 200 }}
                    value={currentAccount}
                    options={accounts.map(account => ({
                        label: account,
                        value: account
                    }))}
                />
                <Button onClick={() => setAccountMode("create")}>新建账号</Button>
                <Button disabled={currentAccount === "Default"} type="primary" onClick={handleDeleteAccount}>删除当前账号</Button>
            </Space>}
            {accountMode === "create" && < Space >
                <span>新建账号：</span>
                <Input
                    ref={createAccountInputRef}
                    style={{ width: 250 }}
                    placeholder='请输入账号名，比如"本科账号"'
                />
                <Button onClick={handleCreateAccount}>创建</Button>
                <Button onClick={() => setAccountMode("select")}>取消</Button>
            </Space>}
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
                <Form.Item name="account_type" label="账号类型（本部 or 密院）">
                    <Select>
                        <Select.Option value="Default">本部</Select.Option>
                        <Select.Option value="JI">密院</Select.Option>
                    </Select>
                </Form.Item>
                <Form.Item name="save_path" label="下载保存目录" required rules={[{ validator: savePathValidator }]}>
                    <PathSelector />
                </Form.Item>
                <Form.Item name="theme" label="UI 主题" >
                    <Select>
                        <Select.Option value="light">明亮主题</Select.Option>
                        <Select.Option value="dark">深色主题</Select.Option>
                    </Select>
                </Form.Item>
                <Form.Item name="color_primary" label="主色调" getValueFromEvent={(color) => {
                    return '#' + color.toHex();
                }} >
                    <ColorPicker onChange={e => consoleLog(LOG_LEVEL_INFO, e)} format="hex" />
                </Form.Item>
                <Form.Item name="llm_api_key" label="大模型（目前只接入了 DeepSeek）的 API KEY">
                    <Input />
                </Form.Item>
                {/* <Form.Item name="proxy_port" label="反向代理本地端口" rules={[{ validator: proxyPortValidator }]}>
                    <InputNumber placeholder="请输入反向代理本地端口" />
                </Form.Item> */}
                {/* <Form.Item name="serve_as_plaintext" label="以纯文本显示的文件拓展名">
                    <Input placeholder="请输入文件拓展名，以英文逗号隔开" />
                </Form.Item> */}
                <Space wrap>
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
                    <Form.Item>
                        <Button onClick={handleTestApiKey}>
                            测试 API KEY
                        </Button>
                    </Form.Item>
                    <Form.Item>
                        {!rawConfig && <Button onClick={getRawConfig}>显示配置</Button>}
                        {rawConfig && <Button onClick={() => setRawConfig("")}>隐藏配置</Button>}
                    </Form.Item>
                    <Form.Item>
                        <Button onClick={() => setShowLogModal(true)}>
                            查看日志
                        </Button>
                    </Form.Item>
                    <Form.Item>
                        <Button onClick={handleOpenConfigDir}>
                            打开配置目录
                        </Button>
                    </Form.Item>
                </Space>
            </Form>
            {showLogModal && <LogModal onClose={() => setShowLogModal(false)} />}
            {rawConfig && <ReactJson style={{ overflow: "scroll" }} src={JSON.parse(rawConfig)} collapsed={1} />}
        </Space>
        {openTour && <Tour open={openTour} onClose={() => setOpenTour(false)} steps={steps} />}
    </BasicLayout >
}