import React, { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import Card from "../common/Card";
import LoadingState from "../common/LoadingState";
import ErrorState from "../common/ErrorState";

// PUBLIC_INTERFACE
export function SessionTrackingChart({
  data,
  loading,
  error,
  chartType,
  filtersConfig,
  emptyMessage = "No session data matches your filters.",
  height = 300,
  label,
  ariaLabel,
  onFilterChange,
  theme = {},
}) {
  /**
   * This is a reusable SessionTrackingChart that can be used in the session tracking summary page and modal.
   * It supports Bar, Line, and Pie modes. Filters are driven from data.
   * All clientside filtering.
   * "filtersConfig": { fields: [{ name, label, type, options }], initialFilters:{} }
   */
  const [activeFilters, setActiveFilters] = useState(
    filtersConfig?.initialFilters || {}
  );

  // Compose filtered data
  const filteredData = useMemo(() => {
    let out = data;
    if (filtersConfig?.fields) {
      for (let filt of filtersConfig.fields) {
        if (activeFilters[filt.name]) {
          out = out.filter((row) =>
            filt.type === "string"
              ? row[filt.name] === activeFilters[filt.name]
              : (row[filt.name] && String(row[filt.name]) === String(activeFilters[filt.name]))
          );
        }
      }
    }
    return out;
  }, [data, activeFilters, filtersConfig]);

  // Distill available filter options from data or config
  function getOptions(field) {
    if (!field.options) {
      return Array.from(new Set(data.map((row) => row[field.name]))).filter((v) => v != null);
    }
    return field.options;
  }

  // Handle filter change
  function handleFilterChange(name, value) {
    const next = { ...activeFilters, [name]: value };
    setActiveFilters(next);
    if (typeof onFilterChange === "function") {
      onFilterChange(next);
    }
  }

  // Theme
  const colors =
    theme.colors || [
      "#2563EB", // primary
      "#F59E0B", // secondary
      "#22d3ee",
      "#4ade80",
      "#818CF8",
      "#6d28d9",
      "#EF4444", // error
      "#A1A1AA",
    ];

  // Accessibility
  const ariaProps = ariaLabel
    ? { "aria-label": ariaLabel, role: "region", tabIndex: 0 }
    : {};

  // Skeleton
  if (loading) {
    return (
      <Card className="flex flex-col items-center justify-center min-h-[48px]" {...ariaProps}>
        <LoadingState height={height} message="Loading session chart..." />
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <ErrorState message={error.message || "Could not load session chart."} />
      </Card>
    );
  }

  if (!filteredData || filteredData.length === 0) {
    return (
      <Card>
        <p className="text-center text-slate-400">{emptyMessage}</p>
      </Card>
    );
  }

  // Chart render
  function renderChart() {
    switch (chartType) {
      case "bar":
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={filteredData}>
              <XAxis dataKey={filtersConfig?.xKey || "x"} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey={filtersConfig?.yKey || "y"} fill={colors[0]} />
            </BarChart>
          </ResponsiveContainer>
        );
      case "line":
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={filteredData}>
              <XAxis dataKey={filtersConfig?.xKey || "x"} />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey={filtersConfig?.yKey || "y"} stroke={colors[0]} />
            </LineChart>
          </ResponsiveContainer>
        );
      case "pie":
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Tooltip />
              <Legend />
              <Pie
                data={filteredData}
                dataKey={filtersConfig?.yKey || "y"}
                nameKey={filtersConfig?.xKey || "x"}
                cx="50%"
                cy="50%"
                outerRadius={Math.round(height / 2.3)}
                fill={colors[0]}
                label
              >
                {filteredData.map((entry, idx) => (
                  <Cell key={`cell-${idx}`} fill={colors[idx % colors.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        );
      default:
        return (
          <div>
            <p>Invalid chart type selected.</p>
          </div>
        );
    }
  }

  // Filters UI
  function renderFilters() {
    if (!filtersConfig?.fields || filtersConfig.fields.length === 0) return null;
    return (
      <form
        className="flex flex-wrap mb-2 gap-3 items-end"
        aria-label="Chart filters"
        role="form"
        onSubmit={(e) => e.preventDefault()}
      >
        {filtersConfig.fields.map((field) => (
          <label
            key={field.name}
            className="flex flex-col text-xs text-slate-600"
          >
            {field.label}
            <select
              className="rounded border px-2 py-1 mt-1 text-base bg-white text-slate-800 theme-border"
              value={activeFilters[field.name] || ""}
              onChange={(e) => handleFilterChange(field.name, e.target.value)}
              aria-label={field.label}
            >
              <option value="">All</option>
              {getOptions(field).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        ))}
      </form>
    );
  }

  return (
    <Card className="bg-slate-50 mb-4 p-2 flex flex-col responsive-chart" {...ariaProps}>
      {label && <h3 className="text-base font-semibold mb-1">{label}</h3>}

      {renderFilters()}
      <div className="w-full" style={{ minHeight: height }}>
        {renderChart()}
      </div>
    </Card>
  );
}

SessionTrackingChart.propTypes = {
  data: PropTypes.array.isRequired,
  loading: PropTypes.bool,
  error: PropTypes.object,
  chartType: PropTypes.string, // "bar"|"line"|"pie"
  filtersConfig: PropTypes.shape({
    fields: PropTypes.arrayOf(
      PropTypes.shape({
        name: PropTypes.string.isRequired,
        label: PropTypes.string.isRequired,
        type: PropTypes.string,
        options: PropTypes.array,
      })
    ),
    initialFilters: PropTypes.object,
    xKey: PropTypes.string,
    yKey: PropTypes.string,
  }),
  emptyMessage: PropTypes.string,
  height: PropTypes.number,
  label: PropTypes.string,
  ariaLabel: PropTypes.string,
  onFilterChange: PropTypes.func,
  theme: PropTypes.object,
};
