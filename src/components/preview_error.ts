import { createContext } from "react";

export const PreviewErrorContext = createContext<(() => void) | undefined>(undefined);
