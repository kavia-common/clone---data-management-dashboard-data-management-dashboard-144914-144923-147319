import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { setTheme } from "./theme";
import httpClient, { setIsSuperAdmin } from "./lib/httpClient";

// Apply dark theme globally based on design tokens
if (typeof window !== "undefined") {
  setTheme("dark");
}

// Attempt to detect Super Admin from persisted profile for initializing all-tenants interceptor
try {
  const raw = localStorage.getItem("userProfile");
  if (raw) {
    const profile = JSON.parse(raw);
    const rolesSrc = Array.isArray(profile?.roles) ? profile.roles : (profile?.role ? [profile.role] : []);
    const isSA = rolesSrc.map((r) => String(r).toLowerCase()).includes("super admin");
    setIsSuperAdmin(isSA);
  }
} catch {}

// Guarded debug demo import
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

/**
 * Configure a Data Router to enable React Router v7-compatible behaviors.
 */
const router = createBrowserRouter(
  [
    { path: "/*", element: <App /> },
  ],
  {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
    },
  }
);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <AuthProvider>
      <RouterProvider
        router={router}
        future={{
          v7_startTransition: true,
        }}
      />
    </AuthProvider>
  </React.StrictMode>
);
