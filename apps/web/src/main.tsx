import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { SessionProvider } from "./session.tsx";
import { App } from "./App.tsx";
import "./styles.css";

const theme = createTheme({
  palette: { mode: "light", primary: { main: "#176b5b" }, secondary: { main: "#d99a3d" }, background: { default: "#f4f6f5", paper: "#ffffff" } },
  shape: { borderRadius: 12 },
  typography: { fontFamily: 'Inter, "Segoe UI", sans-serif', h4: { fontWeight: 700, letterSpacing: "-0.035em" }, h5: { fontWeight: 700 } },
});
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } });

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el elemento raíz de la aplicación.");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
