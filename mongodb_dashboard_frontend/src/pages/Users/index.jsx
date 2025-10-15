import React from "react";
import UsersDashboard from "../dashboard/Users.jsx";

/**
 * PUBLIC_INTERFACE
 * UsersIndex
 * Thin wrapper to reuse the Dashboard Users view under /pages/Users/
 */
export default function UsersIndex() {
  return <UsersDashboard />;
}
