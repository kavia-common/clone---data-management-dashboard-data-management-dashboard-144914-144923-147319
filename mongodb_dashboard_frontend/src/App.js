import React from "react";
import "./App.css";
import AppRoutes from "./routes/AppRoutes";
import { AuthProvider } from "./context/AuthContext";

/**
 * PUBLIC_INTERFACE
 * App - root component that provides Auth context and renders routes.
 */
export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
