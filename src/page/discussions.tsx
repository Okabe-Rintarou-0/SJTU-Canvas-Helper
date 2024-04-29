import { Card, Empty, Select, Space } from "antd";
import BasicLayout from "../components/layout";
import useMessage from "antd/es/message/useMessage";
import { useEffect, useState } from "react";
import { Course, DiscussionTopic, FullDiscussion, User } from "../lib/model";
import { invoke } from "@tauri-apps/api";
import CourseSelect from "../components/course_select";
import { MessageBox } from "react-chat-elements";
import 'react-chat-elements/dist/main.css'

export default function DiscussionsPage() {
    const [messageApi, contextHolder] = useMessage();
    const [topics, setTopics] = useState<DiscussionTopic[]>([]);
    const [me, setMe] = useState<User | undefined>(undefined);
    const [operating, setOperating] = useState<boolean>(false);
    const [courses, setCourses] = useState<Course[]>([]);
    const [selectedTopic, setSelectedTopic] = useState<DiscussionTopic | undefined>(undefined);
    const [fullDiscussion, setFullDiscussion] = useState<FullDiscussion | undefined>(undefined);
    const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);

    useEffect(() => {
        initCourses();
        initMe();
    }, []);

    const initMe = async () => {
        try {
            const me = await invoke("get_me") as User;
            setMe(me);
        } catch (e) {
            console.log(e);
        }
    }

    const initCourses = async () => {
        try {
            let courses = await invoke("list_courses") as Course[];
            setCourses(courses);
        } catch (e) {
            messageApi.error(e as string);
        }
    }

    const handleGetDiscussionTopics = async (courseId: number) => {
        try {
            const topics = await invoke("list_discussion_topics", { courseId }) as DiscussionTopic[];
            setTopics(topics);
        } catch (e) {
            messageApi.error(`获取讨论话题失败☹️：${e}`);
        }
    }

    const handleCourseSelect = async (courseId: number) => {
        setOperating(true);
        setSelectedCourseId(courseId);
        if (courses.find(course => course.id === courseId)) {
            setTopics([]);
            handleGetDiscussionTopics(courseId);
        }
        setOperating(false);
    }

    const handleGetFullDiscussion = async (topicId: number) => {
        const courseId = selectedCourseId;
        try {
            let fullDiscussion = await invoke("get_full_discussion", { courseId, topicId }) as FullDiscussion;
            setFullDiscussion(fullDiscussion);
        } catch (e) {
            console.log(e);
            messageApi.error(`获取讨论内容失败：${e}`);
        }
    }

    const handleTopicSelect = (topicId: number) => {
        handleGetFullDiscussion(topicId);
        setSelectedTopic(topics.find(topic => topic.id === topicId));
    }

    return <BasicLayout>
        {contextHolder}
        <Space direction="vertical" style={{ width: "100%", overflow: "scroll" }} size={"large"}>
            <CourseSelect onChange={handleCourseSelect} disabled={operating} courses={courses} />
            <Space>
                <span>选择讨论话题：</span>
                <Select
                    key={selectedCourseId}
                    style={{ width: 350 }}
                    disabled={operating}
                    onChange={handleTopicSelect}
                    options={topics.map(topic => ({
                        label: topic.title,
                        value: topic.id
                    }))}
                />
            </Space>
            {!fullDiscussion && <Empty />}
            {fullDiscussion &&
                <Card styles={{ body: { backgroundColor: "#f5f5f5f5", width: "100%" } }}>
                    <Space direction='vertical' style={{ width: "100%" }}>
                        <div style={{ overflow: "scroll", width: "100%" }}>
                            {selectedTopic && <MessageBox
                                key={selectedTopic.id}
                                id={selectedTopic.id}
                                focus={false}
                                titleColor=''
                                forwarded={false}
                                styles={{
                                    marginBottom: "10px"
                                }}
                                removeButton={false}
                                status='received'
                                notch={false}
                                retracted={false}
                                title={selectedTopic.title}
                                position={'left'}
                                type={'text'}
                                // hack here
                                text={<div style={{ maxWidth: "500px" }} dangerouslySetInnerHTML={{ __html: selectedTopic.message }} /> as unknown as string}
                                replyButton={false}
                                date={selectedTopic.created_at ? new Date(selectedTopic.created_at) : new Date()}
                            />}
                            {fullDiscussion.view.map(view => {
                                const user = fullDiscussion.participants.find(p => p.id === view.user_id);
                                if (!user) {
                                    return null;
                                }
                                const is_mine = user.id === me?.id;
                                const position = is_mine ? "right" : "left";
                                const color = is_mine ? "#E6E6FA" : undefined;
                                return <MessageBox
                                    key={view.id}
                                    id={view.id}
                                    focus={false}
                                    titleColor=''
                                    forwarded={false}
                                    styles={{
                                        background: color,
                                        marginBottom: "10px"
                                    }}
                                    removeButton={false}
                                    status='received'
                                    notch={false}
                                    retracted={false}
                                    title={user.display_name}
                                    avatar={user.avatar_image_url}
                                    position={position}
                                    type={'text'}
                                    // hack here
                                    text={<div style={{ maxWidth: "500px" }} dangerouslySetInnerHTML={{ __html: view.message ?? "" }} /> as unknown as string}
                                    replyButton={false}
                                    date={view.created_at ? new Date(view.created_at) : new Date()}
                                />
                            })}
                        </div>
                    </Space>
                </Card>
            }
        </Space>
    </BasicLayout >
}