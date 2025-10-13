import React from "react";
import Card from "../../components/ui/Card.jsx";

/**
 * PUBLIC_INTERFACE
 * Dashboard Overview (reverted): simple overview card without dynamic modules fetching.
 */
export default function Overview() {
  return (
    <div className="grid" style={{ padding: 16 }}>
      <Card title="Overview" className="block-full">
        <div style={{ color: "#4B5563", fontSize: 14 }}>
          Welcome to your dashboard. Use the sidebar to navigate between sections.
        </div>
      </Card>
    </div>
  );
}
