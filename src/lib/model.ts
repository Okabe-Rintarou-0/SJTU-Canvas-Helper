export const LOG_LEVEL_DEBUG = 0;
export const LOG_LEVEL_INFO = 1;
export const LOG_LEVEL_WARN = 2;
export const LOG_LEVEL_ERROR = 3;

export type LogLevel = number;

export type Option<T> = T | null | undefined;

export interface Course {
    id: number;
    uuid: string;
    name: string;
    course_code: string;
    enrollments: Enrollment[];
    teachers: Teacher[];
    term: Term;
}

interface Term {
    id: number;
    name: string;
    start_at: Option<string>;
    end_at: Option<string>;
    created_at: Option<string>;
    workflow_state: string;
}

export type EnrollmentRole = "TaEnrollment" | "StudentEnrollment" | "TeacherEnrollment" | "DesignerEnrollment" | "ObserverEnrollment";

export interface Enrollment {
    type: string;
    role: EnrollmentRole;
    role_id: number;
    user_id: number;
    enrollment_state: string;
}

export interface RelationshipNode {
    id: string;
    label: string;
    nodeType: "Default" | "Me" | "Course"
}

export interface RelationshipEdge {
    source: string;
    target: string;
}

export interface RelationshipTopo {
    nodes: RelationshipNode[];
    edges: RelationshipEdge[];
}

export interface File {
    key: string;
    id: number;
    uuid: string;
    folder_id: number;
    url: string;
    display_name: string;
    locked: boolean;
    filename: string;
    mime_class: string;
    "content-type": string;
    size: number;
    external_type?: "File" | "Link";
    external_title?: string;
}

export interface Folder {
    key: string;
    id: number;
    name: string;
    full_name: string;
    parent_folder_id: Option<number>;
    locked: boolean;
    folders_url: string;
    files_url: string;
    files_count: number;
    folders_count: number;
}

export type Entry = File | Folder;
export function isFile(entry: Entry) {
    return 'display_name' in entry;
}
export function entryName(entry: Entry) {
    if (isFile((entry))) {
        return (entry as File).display_name;
    }
    else {
        return (entry as Folder).name;
    }
}

export interface User {
    id: number;
    key: number;
    name: string;
    created_at: string;
    sortable_name: string;
    short_name: string;
    login_id: string;
    email: Option<string>;
}

export interface UserSubmissions {
    user_id: number;
    username: Option<string>;
    submissions: Submission[]
}

export interface Colors {
    custom_colors: { [key: string]: string };
}

export interface CalendarEvent {
    title: string;
    workflow_state: string;
    id: string;
    type_field: string;
    assignment: Assignment;
    html_url: string;
    end_at: Option<string>;
    start_at: Option<string>;
    context_code: string;
    context_name: string;
    url: string;
    important_dates: boolean;
}

export interface Assignment {
    id: number;
    key: number;
    needs_grading_count: Option<number>;
    description: Option<string>;
    due_at: Option<string>;
    unlock_at: Option<string>;
    lock_at: Option<string>;
    points_possible: Option<number>;
    course_id: number;
    name: string;
    html_url: string;
    submission_types: string[];
    allowed_extensions: string[];
    published: boolean;
    has_submitted_submissions: boolean;
    submission: Option<Submission>;
    overrides: AssignmentOverride[];
    all_dates: AssignmentDate[];
    score_statistics: Option<ScoreStatistic>;
    grading_type: string;
}

export interface AssignmentDate {
    id: number;
    base: boolean;
    title: string;
    due_at: Option<string>;
    unlock_at: Option<string>;
    lock_at: Option<string>;
}

export interface AssignmentOverride {
    id: number;
    pub_id: number;
    assignment_id: number;
    quiz_id: number;
    context_module_id: number;
    student_ids: number[];
    group_id: number;
    course_section_id: number;
    title: string;
    due_at: Option<string>;
    all_day: boolean;
    all_day_date: string;
    unlock_at: Option<string>;
    lock_at: Option<string>;
}

export type WorkflowState = "submitted" | "unsubmitted" | "graded" | "pending_review";

export interface Submission {
    id: number;
    key: number;
    grade: Option<string>;
    submitted_at: Option<string>;
    assignment_id: number;
    user_id: number;
    late: boolean;
    attachments: Attachment[];
    submission_comments: SubmissionComment[];
    workflow_state: WorkflowState;
}

export interface GradeStatistic {
    grades: number[];
    total: number;
}

export interface ScoreStatistic {
    min: number;
    max: number;
    mean: number;
}

export interface Attachment {
    user: Option<string>;
    user_id: number;
    submitted_at: Option<string>;
    grade: Option<string>;
    id: number;
    key: React.Key;
    late: boolean;
    comments: SubmissionComment[];
    uuid: string;
    folder_id: Option<number>;
    display_name: string;
    filename: string;
    "content-type": string;
    url: string;
    size: number;
    locked: boolean;
    mime_class: string;
    preview_url: string;
}

export interface FileDownloadTask {
    key: string;
    file: File;
    progress: number;
    state: DownloadState;
}

export interface VideoDownloadTask {
    key: string;
    video: VideoPlayInfo;
    progress: number;
    state: DownloadState;
}

export interface DownloadTask {
    key: string;
    name: string;
    progress: number;
    state: "downloading" | "completed" | "fail" | "merging";
}

export type DownloadState = "downloading" | "succeed" | "fail" | "wait_retry";
export type Theme = "light" | "dark";

export interface AppConfig {
    token: string;
    account_type: "Default" | "JI";
    save_path: string;
    serve_as_plaintext: string;
    ja_auth_cookie: string;
    video_cookies: string;
    proxy_port: number;
    course_assignment_file_bindings: Record<number, File[]>;
    show_alert_map: Record<string, boolean>;
    llm_api_key: string;
    theme: Option<Theme>;
    compact_mode: boolean;
    color_primary: Option<string>;
}

export interface AccountInfo {
    current_account: string;
    all_accounts: string[];
}

export interface ExportUsersConfig {
    save_name: string;
}

export interface ProgressPayload {
    uuid: string;
    processed: number;
    total: number;
}

export interface Payload {
    sig: string;
    ts: number;
}

export interface LoginMessage {
    error: number;
    payload: Payload;
    type: string;
}

export interface Subject {
    subjectId: number;
    csplId: number;
    subjectName: string;
    classroomId: number;
    classroomName: string;
    userId: number;
    userName: string;
    courTimes: number;
    subjImgUrl: string;
    teclId: number;
    teclName: string;
    termTime: number;
    beginYear: number;
    endYear: number;
}

export interface VideoCourse {
    videPlayCount: number;
    videCommentAverage: number;
    videPalyTime: number;
    videPalyTimes: number;
    videImgUrl: string;
    subjName: string;
    subjId: number;
    courId: number;
    responseVoList: Video[];
    courTimes: number;
    subjImgUrl: string;
    teclId: number;
    teclName: string;
    indexCount: number;
    csplId: number;
    tetiBeginYear: number;
    tetiEndYear: number;
    tetiTerm: number;
}

export interface CanvasVideo {
    videoId: string;
    userName: string;
    videoName: string;
    classroomName: string;
    courseBeginTime: string,
    courseEndTime: string,
}

export interface Video {
    id: number;
    userName: string;
    userId: number;
    videName: string;
    videPlayCount: number;
    videCommentAverage: number;
    videPalyTime: number;
    videPalyTimes: number;
    videSource: number;
    subjId: number;
    courId: number;
    courBeginTime: number;
    courEndTime: number;
    courTimes: number;
    indexCount: number;
    csplId: number;
    videId: number;
}

export interface VideoPlayInfo {
    name: string;
    key: number;
    id: number;
    index: number;
    videPlayTime: number;
    clientIpType: number;
    rtmpUrlHdv: string;
    cdviChannelNum: number;
    cdviViewNum: number;
}

export interface VideoInfo {
    id: number;
    courId: number;
    videSource: number;
    smseId: number;
    videVodId: number;
    cminId: number;
    deviPuid: string;
    videRecordChannelNum: number;
    videBeginTime: string;
    videEndTime: string;
    videPlayTime: number;
    videName: string;
    videPlayCount: number;
    videCommentCount: number;
    videCommentAverage: number;
    courTimes: number;
    courName: string;
    organizationName: string;
    subjId: number;
    clroId: number;
    clroName: string;
    userId: number;
    userName: string;
    subjName: string;
    teclName: string;
    teclId: number;
    rtmpUrlHdv: string;
    userAvatar: string;
    loginUserId: number;
    videBeginTimeMs: number;
    videEndTimeMs: number;
    videoPlayResponseVoList: VideoPlayInfo[];
}

export interface Teacher {
    id: number;
    anonymous_id: string;
    display_name: string;
    avatar_image_url: string;
    html_url: string;
}

export interface MediaComment {
    content_type: string;
    display_name: string;
    media_id: string;
    media_type: string;
    url: string;
}

export interface SubmissionComment {
    id: number;
    comment: string;
    author_id: number;
    author_name: string;
    created_at: string;
    avatar_path: string;
    media_comment: Option<MediaComment>;
    attachments: Attachment[]
}

export interface GradeStatus {
    assignmetName: string;
    maxGrade: number;
    actualGrade: number;
}

export interface QRCodeScanResult {
    file: File,
    contents: string[];
}

export interface DiscussionTopic {
    id: number;
    title: string;
    last_reply_at: Option<string>;
    created_at: Option<string>;
    delayed_post_at: Option<string>;
    posted_at: Option<string>;
    user_name: Option<string>;
    lock_at: Option<string>;
    assignment_id: Option<number>;
    podcast_has_student_posts: Option<boolean>;
    discussion_type: string;
    allow_rating: Option<boolean>;
    only_graders_can_rate: Option<boolean>;
    sort_by_rating: Option<boolean>;
    is_section_specific: Option<boolean>;
    discussion_subentry_count: number;
    permissions: Permissions;
    require_initial_post: Option<boolean>;
    user_can_see_posts: Option<boolean>;
    podcast_url: Option<string>;
    read_state: string;
    unread_count: number;
    subscribed: Option<boolean>;
    attachments: Attachment[];
    published: Option<boolean>;
    can_unpublish: Option<boolean>;
    locked: Option<boolean>;
    can_lock: Option<boolean>;
    comments_disabled: Option<boolean>;
    html_url: string;
    url: string;
    pinned: Option<boolean>;
    can_group: Option<boolean>;
    locked_for_user: Option<boolean>;
    lock_explanation: string;
    message: string;
    assignment: Option<Assignment>;
}

export interface Permissions {
    attach: boolean;
    update: boolean;
    reply: boolean;
    delete: boolean;
}

export interface FullDiscussion {
    unread_entries: number[];
    new_entries: number[];
    participants: Participant[];
    view: DiscussionView[];
}

export interface Participant {
    id: number;
    anonymous_id: string;
    display_name: string;
    avatar_image_url: string;
    html_url: string;
}

export interface DiscussionView {
    id: number;
    parent_id: Option<number>;
    created_at: Option<string>;
    updated_at: Option<string>;
    editor_id: Option<number>;
    rating_count: Option<number>;
    rating_sum: Option<number>;
    deleted: Option<boolean>;
    user_id: Option<number>;
    message: Option<string>;
    replies: Reply[];
}

export interface Reply {
    id: number;
    user_id: number;
    parent_id: number;
    created_at: Option<string>;
    updated_at: Option<string>;
    rating_count: Option<number>;
    rating_sum: Option<number>;
    message: Option<string>;
}

export interface DraggableItem {
    id: string;
    content: string;
    data: any;
}

export interface VideoAggregateParams {
    mainVideoPath: string;
    subVideoPath: string;
    outputDir: string;
    outputName: string;
    // 0% ~ 100%, 100% by default
    subVideoAlpha: number;
    // 0% ~ 50%, 25% by default
    subVideoSizePercentage: number;
}

export interface AnnualCourseStatistic {
    courseId: number;
    courseName: string;
    submitTimeList: string[];
}

export interface AnnualReport {
    year: number;
    courseToStatistic: Record<number, AnnualCourseStatistic>;
}

export interface CompletionRequirement {
    type: string;
    min_score: Option<number>;
    completed: boolean;
}

export interface ContentDetails {
    points_possible: Option<number>;
    due_at: Option<string>;
    unlock_at: Option<string>;
    lock_at: Option<string>;
}

export type ModuleItemType =
    | 'File'
    | 'Page'
    | 'Discussion'
    | 'Assignment'
    | 'Quiz'
    | 'SubHeader'
    | 'ExternalUrl'
    | 'ExternalTool';

export interface ModuleItem {
    id: number;
    module_id: number;
    position: number;
    title: string;
    indent: number;
    type: ModuleItemType;
    content_id: Option<number>;
    html_url: string;
    url: Option<string>;
    page_url: Option<string>;
    external_url: Option<string>;
    new_tab: Option<boolean>;
    completion_requirement: Option<CompletionRequirement>;
    content_details: Option<ContentDetails>;
    published: Option<boolean>;
}