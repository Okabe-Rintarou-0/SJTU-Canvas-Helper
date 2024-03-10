import { invoke } from "@tauri-apps/api";
import { useEffect, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import BasicLayout from "../components/layout";
import QRCode from "react-qr-code";
import { SwapOutlined } from '@ant-design/icons';
import { LoginMessage, Video, Subject, VideoCourse, VideoInfo, VideoPlayInfo, VideoDownloadTask } from "../lib/model";
import useMessage from "antd/es/message/useMessage";
import { getConfig, saveConfig } from "../lib/store";
import { Alert, Button, Checkbox, Select, Space, Table } from "antd";
import VideoDownloadTable from "../components/video_download_table";
import videoStyles from "../css/video_player.module.css";

const UPDATE_QRCODE_MESSAGE = "{ \"type\": \"UPDATE_QR_CODE\" }";
const SEND_INTERVAL = 1000 * 50;
const QRCODE_BASE_URL = "https://jaccount.sjtu.edu.cn/jaccount/confirmscancode";
const WEBSOCKET_BASE_URL = "wss://jaccount.sjtu.edu.cn/jaccount/sub";

export default function VideoPage() {
    const getLoginWsURL = async () => {
        let uuid = await invoke("get_uuid") as string | null;
        if (uuid) {
            setUuid(uuid);
            setWsURL(`${WEBSOCKET_BASE_URL}/${uuid}`);
        }
    }
    const [downloadTasks, setDownloadTasks] = useState<VideoDownloadTask[]>([]);
    const [operating, setOperating] = useState<boolean>(false);
    const [subjects, setSubjects] = useState<Subject[]>([]);
    const [messageApi, contextHolder] = useMessage();
    // const [selectedSubject, setSelectedSubject] = useState<Subject | undefined>(undefined);
    const [plays, setPlays] = useState<VideoPlayInfo[]>([]);
    const [selectedVideo, setSelectedVideo] = useState<Video | undefined>(undefined);
    const [videos, setVideos] = useState<Video[]>([]);
    const [qrcode, setQrcode] = useState<string>("");
    const [uuid, setUuid] = useState<string>("");
    const [wsURL, setWsURL] = useState<string>("");
    const [notLogin, setNotLogin] = useState<boolean>(true);
    const [loaded, setLoaded] = useState<boolean>(false);
    const [playURLs, setPlayURLs] = useState<string[]>([]);
    const [mainPlayURL, setMainPlayURL] = useState<string>("");
    const [mutedPlayURL, setMutedPlayURL] = useState<string>("");
    const [syncPlay, setSyncPlay] = useState<boolean>(true);
    const [subVideoSize, setSubVideoSize] = useState<number>(25);
    const mainVideoRef = useRef<HTMLVideoElement>(null);
    const subVideoRef = useRef<HTMLVideoElement>(null);
    const { sendMessage, lastMessage, readyState } = useWebSocket(wsURL, undefined, wsURL.length > 0);
    const firstPlay = useRef<boolean>(true);

    useEffect(() => {
        if (readyState == ReadyState.OPEN) {
            sendMessage(UPDATE_QRCODE_MESSAGE);
            let handle = setInterval(() => {
                sendMessage(UPDATE_QRCODE_MESSAGE);
            }, SEND_INTERVAL);
            return () => {
                clearInterval(handle);
            }
        }
    }, [readyState]);

    const handleUpdateQrcode = (loginMessage: LoginMessage) => {
        let payload = loginMessage.payload;
        let qrcode = `${QRCODE_BASE_URL}?uuid=${uuid}&ts=${payload.ts}&sig=${payload.sig}`;
        setQrcode(qrcode);
    }

    const handleGetSubjects = async () => {
        try {
            const subjects = await invoke("get_subjects") as Subject[];
            setSubjects(subjects);
            return true;
        } catch (e) {
            console.log(e);
            setSubjects([]);
            return false;
        }
    }

    const handleLoginWebsite = async () => {
        try {
            await invoke("login_video_website");
            return true;
        } catch (e) {
            console.log(e);
            return false;
        }
    }

    const handleScanSuccess = async () => {
        try {
            let JAAuthCookie = await invoke("express_login", { uuid }) as string | null;
            if (!JAAuthCookie) {
                return;
            }
            console.log("读取到 JAAuthCookie: ", JAAuthCookie);
            let config = await getConfig();
            config.ja_auth_cookie = JAAuthCookie;
            await saveConfig(config);
            let success = await loginAndCheck(true);
            if (success) {
                messageApi.success("扫码登录成功🎉！", 1);
            }
        } catch (e) {
            messageApi.error(`登录失败🥹：${e}`);
        }
    }

    useEffect(() => {
        if (lastMessage) {
            try {
                let loginMessage = JSON.parse(lastMessage.data) as LoginMessage;
                switch (loginMessage.type.toUpperCase()) {
                    case "UPDATE_QR_CODE":
                        handleUpdateQrcode(loginMessage);
                        break;
                    case "LOGIN":
                        handleScanSuccess();
                        break;
                }
            } catch (e) {
                console.log(e);
            }
        }
    }, [lastMessage]);

    useEffect(() => {
        loginAndCheck();
        return () => {
            if (!firstPlay.current) {
                invoke("stop_proxy");
            }
        }
    }, []);

    const loginAndCheck = async (retry = false) => {
        let config = await getConfig(true);
        let success = await handleLoginWebsite() && await handleGetSubjects();
        if (!success) {
            config.ja_auth_cookie = ""
            await saveConfig(config);
            getLoginWsURL();
        } else if (!retry) {
            messageApi.success("检测到登录会话，登录成功🎉！");
        }
        setNotLogin(!success);
        setLoaded(true);
        return success;
    }

    const handleSelectSubject = (selected: number) => {
        setOperating(true);
        setVideos([]);
        setSelectedVideo(undefined);
        setPlayURLs([]);
        setPlays([]);
        setMainPlayURL("");
        setMutedPlayURL("");
        let subject = subjects.find(subject => subject.subjectId === selected);
        if (subject) {
            // setSelectedSubject(subject);
            handleGetCourse(subject.subjectId, subject.teclId);
        }
        setOperating(false);
    }

    const handleGetVideoInfo = async (video: Video) => {
        try {
            let videoInfo = await invoke("get_video_info", { videoId: video.id }) as VideoInfo;
            let plays = videoInfo.videoPlayResponseVoList;
            plays.map((play, index) => {
                play.key = play.id;
                play.index = index;
                let part = index === 0 ? "" : `_录屏`;
                let suffix = index > 2 ? `_${index}.mp4` : '.mp4';
                play.name = `${video.videName}${part}${suffix}`;
            });
            setPlays(plays);
        } catch (e) {
            messageApi.error(`获取视频信息的时候出现错误🙅：${e}`);
        }
    }

    const handleSelectVideo = (selected: number) => {
        let video = videos.find(video => video.id === selected);
        if (video) {
            setPlays([]);
            setPlayURLs([]);
            setMainPlayURL("");
            setMutedPlayURL("");
            setSelectedVideo(video);
            handleGetVideoInfo(video);
        }
    }

    const handleGetCourse = async (subjectId: number, teclId: number) => {
        try {
            let course = await invoke("get_video_course", { subjectId, teclId }) as VideoCourse | null;
            if (course) {
                setVideos(course.responseVoList);
            }
        } catch (e) {
            messageApi.error(`获取录像的时候发生了错误🙅：${e}`);
        }
    }

    const handleDownloadVideo = (video: VideoPlayInfo) => {
        let videoId = video.id + "";
        if (!downloadTasks.find(task => task.key === videoId)) {
            setDownloadTasks(tasks => [...tasks, {
                key: videoId,
                video,
                video_name: video.name,
                progress: 0,
                state: "downloading"
            } as VideoDownloadTask]);
        } else {
            messageApi.warning("请勿重复添加任务！");
            return;
        }
    }

    const handleRemoveTask = async (taskToRemove: VideoDownloadTask) => {
        setDownloadTasks(tasks => tasks.filter(task => task.key !== taskToRemove.key));
        try {
            await invoke("delete_file_with_name", { name: taskToRemove.video.name });
            // messageApi.success("删除成功🎉！", 0.5);
        } catch (e) {
            if (taskToRemove.state !== "fail") {
                // no need to show error message for already failed tasks
                messageApi.error(e as string);
            }
        }
    }

    const getVidePlayURL = (play: VideoPlayInfo, proxyPort: number) => {
        let playURL = play.rtmpUrlHdv.replace("https://live.sjtu.edu.cn", `http://localhost:${proxyPort}`);
        return playURL;
    }

    const checkOrStartProxy = async () => {
        if (firstPlay.current) {
            messageApi.open({
                key: 'proxy_preparing',
                type: 'loading',
                content: '正在启动反向代理🚀...',
                duration: 0,
            });
            let succeed;
            try {
                succeed = await invoke("prepare_proxy") as boolean;
            } catch (e) {
                messageApi.error(`反向代理启动失败🥹: ${e}`);
            }
            if (succeed) {
                messageApi.destroy('proxy_preparing');
                messageApi.success("反向代理启动成功🎉！", 0.5);
            } else {
                messageApi.error("反向代理启动超时🥹！");
                invoke("stop_proxy");
            }
            firstPlay.current = false;
        }
    }

    const handlePlay = async (play: VideoPlayInfo) => {
        let config = await getConfig();
        let playURL = getVidePlayURL(play, config.proxy_port);
        if (playURLs.find(URL => URL === playURL)) {
            messageApi.warning("已经在播放啦😁");
            return;
        }
        if (playURLs.length === 2) {
            messageApi.error("☹️目前只支持双屏观看");
            return;
        }
        await checkOrStartProxy();
        if (playURLs.length === 0) {
            setMainPlayURL(playURL);
        }
        if (play.index !== 0) {
            setMutedPlayURL(playURL);
        }
        setPlayURLs(playURLs => [...playURLs, playURL]);
    }

    const handlePlayAll = async () => {
        if (playURLs.length === 2) {
            messageApi.warning("已经在播放啦😄");
            return;
        }
        await checkOrStartProxy();
        let config = await getConfig();
        let URLs = [...playURLs];
        plays.map((play, index) => {
            let playURL = getVidePlayURL(play, config.proxy_port);
            if (playURL === mainPlayURL) {
                return;
            }
            URLs.push(playURL);
            if (index === 0) {
                setMainPlayURL(playURL);
            } else {
                setMutedPlayURL(playURL);
            }
        });
        setPlayURLs(URLs);
    }

    const columns = [
        {
            title: '视频名',
            dataIndex: 'name',
            key: 'name',
        },
        {
            title: '操作',
            dataIndex: 'operation',
            key: 'operation',
            render: (_: any, play: VideoPlayInfo) => (
                <Space>
                    <a onClick={e => {
                        e.preventDefault();
                        handleDownloadVideo(play);
                    }}>下载</a>
                    <a onClick={e => {
                        e.preventDefault();
                        handlePlay(play);
                    }}>播放</a>
                </Space>
            ),
        }
    ];

    const shouldShowAlert = loaded && notLogin && qrcode;
    const getVideoClassName = (videoURL: string) => {
        return videoURL === mainPlayURL ? "" : videoStyles.subVideo;
    }

    const getVideoStyle = (videoURL: string) => {
        return { width: videoURL === mainPlayURL ? "100%" : subVideoSize + "%" };
    }

    const getVideoRef = (videoURL: string) => {
        return videoURL === mainPlayURL ? mainVideoRef : subVideoRef;
    }

    const handleSwapVideo = () => {
        if (playURLs.length === 2 && mainPlayURL) {
            setMainPlayURL(playURLs.find(URL => URL !== mainPlayURL)!);
        }
    }

    const noSubVideo = playURLs.length < 2;
    const subVideoSizes = [0, 10, 20, 25, 33, 40, 50];

    const hookVideoHandlers = (swap: boolean) => {
        let mainVideo = mainVideoRef.current;
        let subVideo = subVideoRef.current;
        if (!mainVideo || !subVideo) {
            return;
        }

        if (!swap) {
            subVideo.currentTime = mainVideo.currentTime;
            if (!mainVideo.paused) {
                subVideo.play();
            }
        }

        subVideo.onplay = null;
        mainVideo.onplay = (() => subVideo?.play());

        subVideo.onpause = null;
        mainVideo.onpause = (() => subVideo?.pause());

        subVideo.onseeked = null;
        mainVideo.onseeked = (() => {
            if (subVideo && mainVideo) {
                subVideo.currentTime = mainVideo.currentTime;
            }
        });
    }

    useEffect(() => {
        if (!noSubVideo && syncPlay) {
            hookVideoHandlers(false);
        }
    }, [playURLs]);

    useEffect(() => {
        if (!noSubVideo && syncPlay) {
            hookVideoHandlers(true);
        }
    }, [mainPlayURL]);

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
            {
                shouldShowAlert && <Alert type="warning" showIcon message={"检测到您未登录🙅！您需要登录以继续使用该功能😁"} description={
                    <QRCode style={{ width: "100%" }} value={qrcode} />
                } />
            }
            {!notLogin && <>
                <Space>
                    <span>选择课程：</span>
                    <Select
                        disabled={operating}
                        style={{ width: 300 }}
                        onChange={handleSelectSubject}
                        options={subjects.map(subject => ({
                            label: subject.subjectName,
                            value: subject.subjectId,
                        }))}
                    />
                </Space>
                <Space>
                    <span>选择视频：</span>
                    <Select
                        disabled={operating}
                        style={{ width: 300 }}
                        value={selectedVideo?.id}
                        defaultValue={selectedVideo?.id}
                        onChange={handleSelectVideo}
                        options={videos.map(video => ({
                            label: video?.videName,
                            value: video.id,
                        }))}
                    />
                </Space>
                <Table style={{ width: "100%" }} columns={columns} dataSource={plays} pagination={false} />
                <Space direction="vertical">
                    <Space>
                        <Checkbox disabled={noSubVideo} defaultChecked onChange={(e) => setSyncPlay(e.target.checked)}>同步播放</Checkbox>
                    </Space>
                    <Space>
                        <Button disabled={plays.length < 2} onClick={handlePlayAll}>播放全部</Button>
                        <Button icon={<SwapOutlined />} disabled={noSubVideo} onClick={handleSwapVideo}>主副屏切换</Button>
                        <Select style={{ width: 150 }}
                            disabled={noSubVideo}
                            onChange={(size) => setSubVideoSize(size)}
                            defaultValue={25}
                            options={subVideoSizes.map(size => ({
                                label: "副屏：" + size + "%",
                                value: size
                            }))} />
                    </Space>
                </Space>
                <div className={videoStyles.videoPlayerContainer}>
                    {playURLs.map(playURL => <video className={getVideoClassName(playURL)} key={playURL} style={getVideoStyle(playURL)}
                        ref={getVideoRef(playURL)}
                        controls={playURL === mainPlayURL} autoPlay={false} src={playURL} muted={playURL === mutedPlayURL} />)}
                </div>
                <VideoDownloadTable tasks={downloadTasks} handleRemoveTask={handleRemoveTask} />
            </>}
        </Space>
    </BasicLayout>
}