import { CalendarOutlined, CloudDownloadOutlined, FileOutlined, FormOutlined, SettingOutlined, UserOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { getVersion } from "@tauri-apps/api/app";
import { Layout, Menu, Space, theme } from 'antd';
import useMessage from 'antd/es/message/useMessage';
import React, { useEffect, useState } from 'react';
import { BsQrCode } from 'react-icons/bs';
import { FaPeopleGroup } from "react-icons/fa6";
import { GoDiscussionOutdated } from 'react-icons/go';
import { LuBookOpenCheck } from 'react-icons/lu';
import { TbReportAnalytics } from "react-icons/tb";
import { Link, useLocation } from 'react-router-dom';
import { useKeyPress } from '../lib/hooks';
import { checkForUpdates } from '../lib/utils';
import { ChangeLogModal } from './change_log_modal';
const { Content, Footer, Sider } = Layout;

export default function BasicLayout({ children }: React.PropsWithChildren) {
    const [version, setVersion] = useState<string>("");
    const [showChangeLog, setShowChangeLog] = useState<boolean>(false);

    useEffect(() => {
        getVersion().then(version => setVersion(version));
    }, []);

    const items = [{
        key: 'files',
        icon: <FileOutlined />,
        label: <Link to={'/files'}>文件</Link>,
    }, {
        key: 'assignments',
        icon: <FormOutlined />,
        label: <Link to={'/assignments'}>查看作业</Link>,
    }, {
        key: 'discussions',
        icon: <GoDiscussionOutdated />,
        label: <Link to={'/discussions'}>讨论区</Link>,
    }, {
        key: 'calendar',
        icon: <CalendarOutlined />,
        label: <Link to={'/calendar'}>日历</Link>,
    }, {
        key: 'users',
        icon: <UserOutlined />,
        label: <Link to={'/users'}>人员导出</Link>,
    }, {
        key: 'grades',
        icon: <LuBookOpenCheck />,
        label: <Link to={'/grades'}>评分册(beta)</Link>,
    }, {
        key: 'submissions',
        icon: <CloudDownloadOutlined />,
        label: <Link to={'/submissions'}>作业批改</Link>,
    }, {
        key: 'video',
        icon: <VideoCameraOutlined />,
        label: <Link to={'/video'}>视频</Link>,
    }, {
        key: 'qrcode',
        icon: <BsQrCode />,
        label: <Link to={'/qrcode'}>二维码</Link>,
    }, {
        key: 'relationship',
        icon: <FaPeopleGroup />,
        label: <Link to={'/relationship'}>人际关系图(beta)</Link>,
    }, {
        key: 'annual',
        icon: <TbReportAnalytics />,
        label: <Link to={'/annual'}>年度总结（新）</Link>,
    }, {
        key: 'settings',
        icon: <SettingOutlined />,
        label: <Link to={'/settings'}>设置</Link>,
    }]

    const parts = useLocation().pathname.split('/');
    const selectedKeys = [parts[parts.length - 1]];

    const {
        token: { colorBgContainer, borderRadiusLG },
    } = theme.useToken();

    const [messageApi, contextHolder] = useMessage();

    const [scale, setScale] = useState(1);

    const zoomIn = () => {
        setScale(prevScale => prevScale + 0.1);
    };

    const zoomOut = () => {
        setScale(prevScale => Math.max(0.1, prevScale - 0.1));
    };

    useKeyPress('=', zoomIn);
    useKeyPress('-', zoomOut);

    return <Layout style={{ minHeight: "100vh" }}>
        {contextHolder}
        <Sider theme="light" style={{ position: 'fixed', height: '100%' }}>
            <Menu theme="light" mode="inline" defaultSelectedKeys={selectedKeys} items={items} />
        </Sider>
        <Layout style={{ marginLeft: 200 }}>
            <Content style={{ margin: '16px 16px 0' }}>
                <div
                    style={{
                        padding: 24,
                        minHeight: 360,
                        background: colorBgContainer,
                        borderRadius: borderRadiusLG,
                        zoom: scale,
                        transformOrigin: 'top left',
                        width: '100%',
                        height: '100%',
                    }}
                >
                    {children}
                </div>
            </Content>
            <ChangeLogModal open={showChangeLog} onCancel={() => setShowChangeLog(false)} onOk={() => setShowChangeLog(false)} />
            <Footer style={{ textAlign: 'center' }}>
                <Space>
                    <span>当前版本：{version}</span>
                    <a onClick={() => checkForUpdates(messageApi)}>检查更新</a>
                    <a onClick={(e) => {
                        e.preventDefault();
                        setShowChangeLog(true);
                    }}>更新日志</a>
                    <a href='mailto:923048992@sjtu.edu.cn' target='_blank'>我要反馈</a>
                </Space>
                <br />
                SJTU Canvas Helper ©{new Date().getFullYear()} Created by <a target="_blank" href='https://github.com/Okabe-Rintarou-0'>Okabe</a>
            </Footer>
        </Layout>
    </Layout>
}