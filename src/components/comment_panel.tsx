import { Avatar, Button, Divider, List, Space } from "antd";
import { Attachment, Entry, User } from "../lib/model";
import TextArea, { TextAreaRef } from "antd/es/input/TextArea";
import { useRef } from "react";
import { MessageInstance } from "antd/es/message/interface";
import { invoke } from "@tauri-apps/api";
import { attachmentToFile } from "../lib/utils";

export default function CommentPanel({ attachment, assignmentId, courseId, showInput, me, onRefresh, onFocus, onBlur, onHoverEntry, onLeaveEntry, messageApi }:
    {
        attachment: Attachment,
        assignmentId: number,
        courseId: number,
        showInput: boolean,
        me?: User,
        onRefresh?: (userId: number) => Promise<void>,
        onFocus?: () => void,
        onBlur?: () => void,
        onHoverEntry?: (entry: Entry) => void,
        onLeaveEntry?: () => void,
        onPreviewEntry?: (entry: Entry) => void,
        messageApi: MessageInstance
    }) {
    const commentInputRef = useRef<TextAreaRef>(null);
    const handleCommentSubmission = async (attachment: Attachment) => {
        const comment = commentInputRef.current?.resizableTextArea?.textArea.value;
        if (!comment) {
            messageApi.warning("评论不得为空！");
            return;
        }
        try {
            await invoke("update_grade", {
                courseId,
                assignmentId,
                studentId: attachment.user_id,
                grade: attachment.grade ?? "",
                comment
            });
            await messageApi.success("评论成功！🎉", 0.5);
            await onRefresh?.(attachment.user_id);
        } catch (e) {
            console.log(e as string);
            messageApi.error(e as string);
        }
    }

    const handleDeleteComment = async (commentId: number, attachment: Attachment) => {
        try {
            await invoke("delete_submission_comment", {
                courseId,
                assignmentId,
                studentId: attachment.user_id,
                commentId
            });
            await onRefresh?.(attachment.user_id);
            messageApi.success("删除成功！🎉", 0.5);
        } catch (e) {
            console.log(e as string);
            messageApi.error(e as string);
        }
    }

    return <Space direction="vertical" style={{ width: "100%" }}>
        <Button onClick={() => onRefresh?.(attachment.user_id)}>刷新评论</Button>
        {attachment.comments.length > 0 && <>
            <Divider>历史评论</Divider>
            <List
                itemLayout="horizontal"
                dataSource={attachment.comments}
                renderItem={(comment) => (
                    <List.Item actions={comment.author_id === me?.id ? [<a onClick={(e) => {
                        e.preventDefault();
                        handleDeleteComment(comment.id, attachment);
                    }}>删除</a>] : undefined}>
                        <List.Item.Meta
                            avatar={<Avatar src={"https://oc.sjtu.edu.cn" + comment.avatar_path} />}
                            title={comment.author_name}
                            description={comment.comment}
                        />
                        {comment.attachments.length > 0 && <Space>
                            <span>附件：</span>
                            {
                                comment.attachments.map(attachment => <a href={attachment.preview_url}
                                    onMouseEnter={() => onHoverEntry?.(attachmentToFile(attachment))}
                                    onMouseLeave={() => onLeaveEntry?.()}
                                > {attachment.display_name}
                                </a>
                                )
                            }
                        </Space>}
                    </List.Item>
                )}
            />
        </>
        }
        {
            showInput &&
            <>
                <Divider>发表评论</Divider>
                <TextArea ref={commentInputRef} placeholder="请输入评论" onFocus={onFocus} onBlur={onBlur} />
                <Button onClick={() => handleCommentSubmission(attachment)}>确认</Button>
            </>
        }
    </Space>
}