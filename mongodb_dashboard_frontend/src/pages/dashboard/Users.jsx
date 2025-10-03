import React from "react";
import UsersList from "../../components/UsersList.jsx";

/**
 * PUBLIC_INTERFACE
 * Users page
 * Container page that reuses the shared UsersList component.
 * This keeps the dashboard consistent and lets us adjust list behavior in one place.
 */
export default function Users() {
  return (
    <div>
      <UsersList
        title="Users"
        subtitle="All users"
        showActions={false}
        tabs={[
          { key: "all", label: "All" },
          { key: "active", label: "Active" },
          { key: "suspended", label: "Suspended" }
        ]}
        initialTabKey="all"
      />
    </div>
  );
}
