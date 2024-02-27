import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import FilePage from "../page/file";
import SettingsPage from "../page/settings";

export default function AppRouter() {
    return <BrowserRouter>
        <Routes>
            <Route index element={<Navigate to={"/file"} />} />
            <Route path="/file" element={<FilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
        </Routes>
    </BrowserRouter>
}