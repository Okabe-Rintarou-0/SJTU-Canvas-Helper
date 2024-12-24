import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import FilesPage from "../page/files";
import SettingsPage from "../page/settings";
import UsersPage from "../page/users";
import AssignmentsPage from "../page/assignments";
import SubmissionsPage from "../page/submissions";
import CalendarPage from "../page/calendar";
import VideoPage from "../page/video";
import QRCodePage from "../page/qrcode";
import DiscussionsPage from "../page/discussions";
import GradePage from "../page/grades";
import RelationshipPage from "../page/relationship";
import AnnualPage from "../page/annual";

export default function AppRouter() {
    return <BrowserRouter>
        <Routes>
            <Route index element={<Navigate to={"/files"} />} />
            <Route path="/annual" element={<AnnualPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/assignments" element={<AssignmentsPage />} />
            <Route path="/discussions" element={<DiscussionsPage />} />
            <Route path="/grades" element={<GradePage />} />
            <Route path="/submissions" element={<SubmissionsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/video" element={<VideoPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/qrcode" element={<QRCodePage />} />
            <Route path="/relationship" element={<RelationshipPage />} />
            <Route path="*" element={<Navigate to={"/"} />} />
        </Routes>
    </BrowserRouter>
}