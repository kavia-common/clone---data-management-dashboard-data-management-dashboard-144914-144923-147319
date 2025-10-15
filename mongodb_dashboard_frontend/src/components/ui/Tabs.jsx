import React from "react";

/**
 * PUBLIC_INTERFACE
 * Tabs
 * Minimal horizontal tabs matching the style guide and tabs_and_table_design_notes.
 * - Renders a tablist with buttons styled as subtle pills + underline indicator.
 * - Use via: <Tabs tabs={[{key:'all',label:'All'}]} activeKey="all" onChange={(k)=>...} />
 */
// PUBLIC_INTERFACE
export default function Tabs({
  tabs = [],
  activeKey,
  onChange,
  className = "",
  "aria-label": ariaLabel = "Section tabs",
}) {
  /** Accessible tabs bar. Buttons update via onChange with the selected key. */
  if (!Array.isArray(tabs) || tabs.length === 0) return null;
  const handleSelect = (key) => {
    if (typeof onChange === "function") onChange(key);
  };
  return (
    <div className={`tabs ${className}`.trim()} role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => {
        const selected = String(activeKey) === String(t.key);
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            className={`tab ${selected ? "active" : ""}`}
            aria-selected={selected}
            onClick={() => handleSelect(t.key)}
            title={t.label}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
