import React from "react";
import "./App.css";
import AppRoutes from "./routes/AppRoutes";
import { DataProvider } from "./context/DataContext.jsx";

// PUBLIC_INTERFACE
export default function App() {
  /** Root component rendering application routes with a centralized DataProvider (users/sessions cached). */
  return (
    <DataProvider>
      <AppRoutes />
    </DataProvider>
  );
}
