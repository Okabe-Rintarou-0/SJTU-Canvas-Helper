import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import FilesPage from "../page/files";
import SettingsPage from "../page/settings";
import UsersPage from "../page/users";
import AssignmentsPage from "../page/assignments";

export default function AppRouter() {
    return <BrowserRouter>
        <Routes>
            <Route index element={<Navigate to={"/files"} />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/assignments" element={<AssignmentsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to={"/"} />} />
        </Routes>
    </BrowserRouter>
}