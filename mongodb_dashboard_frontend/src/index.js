import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";

// Guarded debug demo: only log in development to avoid noisy logs in production
// Also avoid static import of crypto to prevent build/init-time failures when salt is placeholder.
if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "development") {
  import("./utils/crypto")
    .then((mod) => {
      try {
        if (mod && typeof mod.encryptTenantId === "function" && typeof mod.isTenantSaltValid === "function") {
          if (mod.isTenantSaltValid()) {
            // eslint-disable-next-line no-console
            console.log(mod.encryptTenantId("T0002"));
          } else {
            // eslint-disable-next-line no-console
            console.warn("Skipping encryptTenantId demo: tenant salt is not configured.");
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("encryptTenantId demo failed", e);
      }
    })
    .catch(() => {
      // ignore demo import errors
    });
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
