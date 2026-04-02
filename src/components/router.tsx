import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import AnnualPage from "../page/annual";
import AssignmentsPage from "../page/assignments";
import CalendarPage from "../page/calendar";
import DiscussionsPage from "../page/discussions";
import FilesPage from "../page/files";
import GradePage from "../page/grades";
import QRCodePage from "../page/qrcode";
import RelationshipPage from "../page/relationship";
import SettingsPage from "../page/settings";
import SubmissionsPage from "../page/submissions";
import UsersPage from "../page/users";
import VideoPage from "../page/video";

// 路由配置对象
const routesConfig = [
    { path: "/annual", element: <AnnualPage /> },
    { path: "/assignments", element: <AssignmentsPage /> },
    { path: "/calendar", element: <CalendarPage /> },
    { path: "/discussions", element: <DiscussionsPage /> },
    { path: "/files", element: <FilesPage /> },
    { path: "/grades", element: <GradePage /> },
    { path: "/qrcode", element: <QRCodePage /> },
    { path: "/relationship", element: <RelationshipPage /> },
    { path: "/settings", element: <SettingsPage /> },
    { path: "/submissions", element: <SubmissionsPage /> },
    { path: "/users", element: <UsersPage /> },
    { path: "/video", element: <VideoPage /> },
];

export default function AppRouter() {
    return (
        <BrowserRouter>
            <Routes>
                <Route index element={<Navigate to="/files" />} />
                {routesConfig.map((route, index) => (
                    <Route key={index} path={route.path} element={route.element} />
                ))}
                <Route path="*" element={<Navigate to="/" />} />
            </Routes>
        </BrowserRouter>
    );
}