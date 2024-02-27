export type Course = {
    id: Number,
    uuid: string,
    name: string,
    course_code: string,
}

export type File = {
    id: Number,
    folder_id: Number,
    url: string,
    display_name: string,
    filename: string,
}

export type AppConfig = {
    token: string,
}