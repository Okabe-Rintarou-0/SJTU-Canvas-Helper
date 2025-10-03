import { Card, Empty, Select, Space } from "antd";
import BasicLayout from "../components/layout";
import useMessage from "antd/es/message/useMessage";
import { useState } from "react";
import { DiscussionTopic, FullDiscussion, LOG_LEVEL_ERROR } from "../lib/model";
import { invoke } from "@tauri-apps/api/core";
import CourseSelect from "../components/course_select";
import { MessageBox } from "react-chat-elements";
import { useCourses, useMe } from "../lib/hooks";

import "react-chat-elements/dist/main.css";
import { consoleLog } from "../lib/utils";

export default function DiscussionsPage() {
  const [messageApi, contextHolder] = useMessage();
  const [topics, setTopics] = useState<DiscussionTopic[]>([]);
  const [operating, setOperating] = useState<boolean>(false);
  const [selectedTopic, setSelectedTopic] = useState<
    DiscussionTopic | undefined
  >();
  const [fullDiscussion, setFullDiscussion] = useState<
    FullDiscussion | undefined
  >();
  const [selectedCourseId, setSelectedCourseId] = useState<number>(-1);
  const courses = useCourses();
  const me = useMe();

  const handleGetDiscussionTopics = async (courseId: number) => {
    try {
      const topics = (await invoke("list_discussion_topics", {
        courseId,
      })) as DiscussionTopic[];
      setTopics(topics);
    } catch (e) {
      messageApi.error(`获取讨论话题失败☹️：${e}`);
    }
  };

  const handleCourseSelect = async (courseId: number) => {
    setOperating(true);
    setSelectedCourseId(courseId);
    if (courses.data.find((course) => course.id === courseId)) {
      setTopics([]);
      handleGetDiscussionTopics(courseId);
    }
    setOperating(false);
  };

  const handleGetFullDiscussion = async (topicId: number) => {
    const courseId = selectedCourseId;
    try {
      let fullDiscussion = (await invoke("get_full_discussion", {
        courseId,
        topicId,
      })) as FullDiscussion;
      setFullDiscussion(fullDiscussion);
    } catch (e) {
      consoleLog(LOG_LEVEL_ERROR, e);
      messageApi.error(`获取讨论内容失败：${e}`);
    }
  };

  const handleTopicSelect = (topicId: number) => {
    handleGetFullDiscussion(topicId);
    setSelectedTopic(topics.find((topic) => topic.id === topicId));
  };

  return (
    <BasicLayout>
      {contextHolder}
      <Space
        direction="vertical"
        style={{ width: "100%", overflow: "scroll" }}
        size={"large"}
      >
        <CourseSelect
          onChange={handleCourseSelect}
          disabled={operating}
          courses={courses.data}
        />
        <Space>
          <span>选择讨论：</span>
          <Select
            key={selectedCourseId}
            style={{ width: 350 }}
            disabled={operating}
            onChange={handleTopicSelect}
            options={topics.map((topic) => ({
              label: topic.title,
              value: topic.id,
            }))}
          />
        </Space>
        {!fullDiscussion && <Empty />}
        {fullDiscussion && (
          <Card
            styles={{ body: { backgroundColor: "#f5f5f5f5", width: "100%" } }}
          >
            <Space direction="vertical" style={{ width: "100%" }}>
              <div style={{ overflow: "scroll", width: "100%" }}>
                {selectedTopic && (
                  <MessageBox
                    key={selectedTopic.id}
                    id={selectedTopic.id}
                    focus={false}
                    titleColor=""
                    forwarded={false}
                    styles={{
                      marginBottom: "10px",
                    }}
                    removeButton={false}
                    status="received"
                    notch={false}
                    retracted={false}
                    title={selectedTopic.title}
                    position={"left"}
                    type={"text"}
                    // hack here
                    text={
                      (
                        <div
                          style={{ maxWidth: "500px" }}
                          dangerouslySetInnerHTML={{
                            __html: selectedTopic.message,
                          }}
                        />
                      ) as unknown as string
                    }
                    replyButton={false}
                    date={
                      selectedTopic.created_at
                        ? new Date(selectedTopic.created_at)
                        : new Date()
                    }
                  />
                )}
                {fullDiscussion.view.map((view) => {
                  const user = fullDiscussion.participants.find(
                    (p) => p.id === view.user_id
                  );
                  if (!user) {
                    return null;
                  }
                  const is_mine = user.id === me.data?.id;
                  const position = is_mine ? "right" : "left";
                  const color = is_mine ? "#E6E6FA" : undefined;
                  return (
                    <MessageBox
                      key={view.id}
                      id={view.id}
                      focus={false}
                      titleColor=""
                      forwarded={false}
                      styles={{
                        background: color,
                        marginBottom: "10px",
                      }}
                      removeButton={false}
                      status="received"
                      notch={false}
                      retracted={false}
                      title={user.display_name}
                      avatar={user.avatar_image_url}
                      position={position}
                      type={"text"}
                      // hack here
                      text={
                        (
                          <div
                            style={{ maxWidth: "500px" }}
                            dangerouslySetInnerHTML={{
                              __html: view.message ?? "",
                            }}
                          />
                        ) as unknown as string
                      }
                      replyButton={false}
                      date={
                        view.created_at ? new Date(view.created_at) : new Date()
                      }
                    />
                  );
                })}
              </div>
            </Space>
          </Card>
        )}
      </Space>
    </BasicLayout>
  );
}
