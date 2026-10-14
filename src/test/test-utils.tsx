import { createTheme, ThemeProvider } from "@mui/material/styles";
import { render, RenderOptions } from "@testing-library/react";
import { ReactElement } from "react";

const theme = createTheme();

function Wrappers({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

function customRender(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { wrapper: Wrappers, ...options });
}

export * from "@testing-library/react";
export { customRender as render };
