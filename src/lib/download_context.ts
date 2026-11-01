import { createContext } from "react";
import type { DownloadCourse } from "./downloads";

// Archive renderers nested inside document viewers retain their course scope.
export const DownloadCourseContext = createContext<DownloadCourse | undefined>(undefined);
