import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import FilePage from "../page/file";
import SettingsPage from "../page/settings";
import UsersPage from "../page/users";

export default function AppRouter() {
    return <BrowserRouter>
        <Routes>
            <Route index element={<Navigate to={"/file"} />} />
            <Route path="/file" element={<FilePage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to={"/"} />} />
        </Routes>
    </BrowserRouter>
}