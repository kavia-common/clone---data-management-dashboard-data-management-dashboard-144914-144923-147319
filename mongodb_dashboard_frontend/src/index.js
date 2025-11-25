import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { setTheme } from "./theme";

// Apply dark theme globally based on design tokens
if (typeof window !== "undefined") {
  setTheme("dark");
}

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

/**
 * Configure a Data Router to enable React Router v7-compatible behaviors.
 *
 * future.v7_startTransition:
 *   Wraps navigations in React.startTransition for React 18+ concurrent hints.
 *
 * future.v7_relativeSplatPath:
 *   Changes how relative paths resolve from splat (*) routes to match upcoming v7.
 *
 * Docs:
 * - https://reactrouter.com/en/main/routers/create-browser-router#future
 * - https://reactrouter.com/en/main/upgrading/v7 (when available)
 */
const router = createBrowserRouter(
  [
    // Delegate the entire route tree to <App /> which renders <Routes /> and pages.
    // This allows us to adopt future flags without reworking existing route structure.
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
      {/* RouterProvider also accepts a future prop for flags that affect runtime behavior */}
      <RouterProvider
        router={router}
        future={{
          v7_startTransition: true,
        }}
      />
    </AuthProvider>
  </React.StrictMode>
);
