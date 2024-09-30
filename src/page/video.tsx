import { invoke } from "@tauri-apps/api";
import { useEffect, useRef, useState } from "react";
import BasicLayout from "../components/layout";
import { SwapOutlined } from '@ant-design/icons';
import { VideoInfo, VideoPlayInfo, VideoDownloadTask, CanvasVideo, LOG_LEVEL_ERROR } from "../lib/model";
import useMessage from "antd/es/message/useMessage";
import { getConfig, saveConfig } from "../lib/store";
import { Button, Checkbox, Divider, Select, Space, Table } from "antd";
import VideoDownloadTable from "../components/video_download_table";
import videoStyles from "../css/video_player.module.css";
import { LoginAlert } from "../components/login_alert";
import { useCourses, useQRCode } from "../lib/hooks";
import CourseSelect from "../components/course_select";
import ClosableAlert from "../components/closable_alert";
import { VIDEO_PAGE_HINT_ALERT_KEY } from "../lib/constants";
import VideoAggregator from "../components/video_aggregator";
import { consoleLog } from "../lib/utils";

export default function VideoPage() {
    const [downloadTasks, setDownloadTasks] = useState<VideoDownloadTask[]>([]);
    const [operating, setOperating] = useState<boolean>(false);
    const courses = useCourses();
    const [messageApi, contextHolder] = useMessage();
    const [plays, setPlays] = useState<VideoPlayInfo[]>([]);
    const [selectedVideo, setSelectedVideo] = useState<CanvasVideo | undefined>();
    const [videos, setVideos] = useState<CanvasVideo[]>([]);
    const [notLogin, setNotLogin] = useState<boolean>(true);
    const [loaded, setLoaded] = useState<boolean>(false);
    const [playURLs, setPlayURLs] = useState<string[]>([]);
    const [mainPlayURL, setMainPlayURL] = useState<string>("");
    const [mutedPlayURL, setMutedPlayURL] = useState<string>("");
    const [syncPlay, setSyncPlay] = useState<boolean>(true);
    const [subVideoSize, setSubVideoSize] = useState<number>(25);
    const mainVideoRef = useRef<HTMLVideoElement>(null);
    const subVideoRef = useRef<HTMLVideoElement>(null);
    const firstPlay = useRef<boolean>(true);

    const onScanSuccess = () => {
        loginAndCheck(true);
    }
    const { qrcode, showQRCode, refreshQRCode } = useQRCode({ onScanSuccess });

    const handleLoginWebsite = async () => {
        try {
            await invoke("login_canvas_website");
            return true;
        } catch (e) {
            consoleLog(LOG_LEVEL_ERROR, e);
            return false;
        }
    }

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
        let success = await handleLoginWebsite();
        if (!success) {
            config.ja_auth_cookie = ""
            await saveConfig(config);
            showQRCode();
        } else if (!retry) {
            messageApi.success("检测到登录会话，登录成功🎉！");
        } else {
            messageApi.success("登录成功🎉！");
        }
        setNotLogin(!success);
        setLoaded(true);
        return success;
    }

    const handleSelectCourse = (selected: number) => {
        setOperating(true);
        setVideos([]);
        setSelectedVideo(undefined);
        setPlayURLs([]);
        setPlays([]);
        setMainPlayURL("");
        setMutedPlayURL("");
        handleGetVideos(selected);
        setOperating(false);
    }

    const handleGetVideoInfo = async (video: CanvasVideo) => {
        try {
            let videoInfo = await invoke("get_canvas_video_info", { videoId: video.videoId }) as VideoInfo;
            let plays = videoInfo.videoPlayResponseVoList;
            plays.map((play, index) => {
                play.key = play.id;
                play.index = index;
                let part = index === 0 ? "" : `_录屏`;
                let suffix = index > 2 ? `_${index}.mp4` : '.mp4';
                play.name = `${video.videoName}${part}${suffix}`;
            });
            setPlays(plays);
        } catch (e) {
            messageApi.error(`获取视频信息的时候出现错误🙅：${e}`);
        }
    }

    const handleSelectVideo = (selected: string) => {
        let video = videos.find(video => video.videoId === selected);
        if (video) {
            setPlays([]);
            setPlayURLs([]);
            setMainPlayURL("");
            setMutedPlayURL("");
            setSelectedVideo(video);
            handleGetVideoInfo(video);
        }
    }

    const handleGetVideos = async (courseId: number) => {
        try {
            let videos = await invoke("get_canvas_videos", { courseId }) as CanvasVideo[];
            setVideos(videos);
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

    // const handlePlay = async (play: VideoPlayInfo) => {
    //     let config = await getConfig();
    //     let playURL = getVidePlayURL(play, config.proxy_port);
    //     if (playURLs.find(URL => URL === playURL)) {
    //         messageApi.warning("已经在播放啦😁");
    //         return;
    //     }
    //     if (playURLs.length === 2) {
    //         messageApi.error("☹️目前只支持双屏观看");
    //         return;
    //     }
    //     await checkOrStartProxy();
    //     if (playURLs.length === 0) {
    //         setMainPlayURL(playURL);
    //     }
    //     if (play.index !== 0) {
    //         setMutedPlayURL(playURL);
    //     }
    //     setPlayURLs(playURLs => [...playURLs, playURL]);
    // }

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
                    {/* <a onClick={e => {
                        e.preventDefault();
                        handlePlay(play);
                    }}>播放</a> */}
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

        subVideo.onratechange = null;
        mainVideo.onratechange = (() => {
            if (subVideo && mainVideo) {
                subVideo.playbackRate = mainVideo.playbackRate;
            }
        });

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
            <ClosableAlert alertType="info" message={"提示"} configKey={VIDEO_PAGE_HINT_ALERT_KEY}
                description="由于 canvas 启用新版视频系统，目前只恢复了下载功能，暂不支持播放。总体功能尚不稳定，待进一步修复。" />
            {shouldShowAlert && <LoginAlert qrcode={qrcode} refreshQRCode={refreshQRCode} />}
            {!notLogin && <>
                <CourseSelect courses={courses.data} onChange={handleSelectCourse}></CourseSelect>
                <Space>
                    <span>选择视频：</span>
                    <Select
                        disabled={operating}
                        style={{ width: 350 }}
                        value={selectedVideo?.videoId}
                        defaultValue={selectedVideo?.videoId}
                        onChange={handleSelectVideo}
                        options={videos.map(video => ({
                            label: `${video.videoName} ${video.courseBeginTime}`,
                            value: video.videoId,
                        }))}
                    />
                </Space>
                <Table style={{ width: "100%" }} columns={columns} dataSource={plays} pagination={false} />
                <Space direction="vertical">
                    <Space>
                        <Checkbox disabled={noSubVideo} defaultChecked onChange={(e) => setSyncPlay(e.target.checked)}>同步播放</Checkbox>
                    </Space>
                    <Space>
                        <Button disabled onClick={handlePlayAll}>播放全部</Button>
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
            <Divider orientation="left">视频合并</Divider>
            <VideoAggregator />
        </Space>
    </BasicLayout>
}