import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { encryptTenantId } from "./utils/crypto";

// Guarded debug demo: only log in development to avoid noisy logs in production
if (process && process.env && process.env.NODE_ENV === "development") {
  try {
    // Demo call as requested
    // eslint-disable-next-line no-console
    console.log(encryptTenantId("T0002"));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("encryptTenantId demo failed", e);
  }
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
