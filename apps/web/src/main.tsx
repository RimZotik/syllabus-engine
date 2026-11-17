import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "katex/dist/katex.min.css";
import "./styles.css";
import { App } from "./App";
import { AppProvider } from "./state";
import { installErrorReporting } from "./api";

try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch { /* storage unavailable */ }
installErrorReporting();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
