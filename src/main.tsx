import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AccountDataProvider } from "./auth/AccountDataProvider";
import { AuthProvider } from "./auth/AuthProvider";
import "./styles/fonts.css";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <AccountDataProvider>
        <App />
      </AccountDataProvider>
    </AuthProvider>
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => null);
  });
}
