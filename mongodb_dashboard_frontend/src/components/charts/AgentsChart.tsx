import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Legend,
  CartesianGrid,
  Tooltip,
  LabelList,
} from "recharts";
import Card from "../ui/Card.jsx";
import { apiGet } from "../../utils/api";
import LoadingState from "../common/LoadingState.jsx";
import ErrorState from "../common/ErrorState.jsx";
import { getOceanTheme } from "../../theme/oceanTheme";

/**
 * Types for incoming data shapes and component props
 */
type RawCostEvent = {
  agent?: string;
  agent_name?: string;
  agentName?: string;
  name?: string;
  usage?: { cost?: number | string };
  total_cost?: number | string;
  costUSD?: number | string;
  cost?: number | string;
  total?: number | string;
  value?: number | string;
};

type AggregatedAgentCost = {
  agent: string;
  total_cost: number;
};

type AgentsChartProps = {
  title?: string;
  height?: number;
  // PUBLIC_INTERFACE
  onDataReady?: (data: AggregatedAgentCost[]) => void;
};

// PUBLIC_INTERFACE
/**
 * AgentsChart
 * Displays "LLM Cost Distribution by Agent".
 * - Fetches from /api/analytics/llm-cost-by-agent using apiGet (respects REACT_APP_API_BASE_URL).
 * - Defensively handles multiple response shapes, including raw events requiring aggregation.
 * - Sorts totals descending and renders a responsive Recharts BarChart.
 * - Tooltip shows exact cost to 6 decimals.
 * - Empty-state only when the aggregated array is empty (not when totals are zeros).
 * - Exposes aggregated JSON via onDataReady callback and a hidden <pre data-testid="agents-chart-json"> for QA.
 */
export default function AgentsChart({
  title = "LLM Cost Distribution by Agent",
  height = 360,
  onDataReady,
}: AgentsChartProps) {
  const [data, setData] = React.useState<Array<{ name: string; value: number }>>([]);
  const [agg, setAgg] = React.useState<AggregatedAgentCost[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string>("");

  const controllerRef = React.useRef<AbortController | null>(null);

  // Robust number parser for USD-like values
  const toNumber = React.useCallback((v: any): number => {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const s = String(v).replace(/[$,]/g, "").trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }, []);

  // Extract array from envelope or raw
  const extractArray = React.useCallback((payload: any): any[] => {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.data)) return payload.data;
    if (payload && Array.isArray(payload.items)) return payload.items;
    console.warn("[AgentsChart] Unexpected response shape; expected array or {data|items:[...]}.", payload);
    return [];
  }, []);

  // Defensive agent name reader
  const readAgentName = React.useCallback((r: any): string | null => {
    const v =
      r?.agent_name ??
      r?.agentName ??
      r?.agent ??
      r?.name ??
      r?.metadata?.agent_name ??
      r?.metadata?.agent ??
      null;
    if (v == null) return null;
    const s = String(v).trim();
    return s || null;
  }, []);

  // Defensive cost reader, covers pre-aggregated docs and raw events
  const readCost = React.useCallback((r: any): number => {
    const candidates = [
      r?.total_cost,
      r?.costUSD,
      r?.cost,
      r?.total,
      r?.value,
      r?.usage?.cost,
    ];
    for (const c of candidates) {
      const n = toNumber(c);
      if (Number.isFinite(n) && n !== 0) return n;
    }
    // if all candidates are 0/invalid, return 0 (keeps agents with 0 totals)
    return 0;
  }, [toNumber]);

  // Normalize response to aggregated [{ agent, total_cost }]
  const normalizeToAggregated = React.useCallback((payload: any): AggregatedAgentCost[] => {
    const arr = extractArray(payload);
    if (!Array.isArray(arr)) return [];

    // If clearly pre-aggregated (agent + total_cost), remap directly with guards
    const looksAggregated = arr.every(
      (r) =>
        (r && (("agent" in r) || ("agentName" in r) || ("agent_name" in r) || ("name" in r))) &&
        ("total_cost" in r || "costUSD" in r || "total" in r || "cost" in r || "value" in r)
    );

    // Aggregate using a map to ensure we support both aggregated and raw shapes
    const map = new Map<string, number>();
    for (const r of arr as RawCostEvent[]) {
      const agent = readAgentName(r);
      if (!agent) {
        // guard: skip items lacking agent name
        continue;
      }
      const incr = readCost(r);
      map.set(agent, (map.get(agent) || 0) + (Number.isFinite(incr) ? incr : 0));
    }

    let out: AggregatedAgentCost[] = Array.from(map.entries()).map(([agent, total]) => ({
      agent,
      total_cost: Number(total) || 0,
    }));

    // Sorting desc by total_cost
    out.sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0));

    // If response was empty but looked aggregated, we proceed; else just return out
    return out;
  }, [extractArray, readAgentName, readCost]);

  const load = React.useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError("");
    try {
      // Respect REACT_APP_API_BASE_URL if provided; else allow CRA proxy for /api paths
      const base =
        (typeof process !== "undefined" &&
          (process as any).env &&
          (process as any).env.REACT_APP_API_BASE_URL) || "";
      const endpoint = "/api/analytics/llm-cost-by-agent";
      const url = base
        ? `${String(base).replace(/\/$/, "")}${endpoint}`
        : endpoint;

      const res = await apiGet<any>(url, { signal: controller.signal });

      const aggregated = normalizeToAggregated(res);
      console.debug("[AgentsChart] Aggregated agent cost", aggregated);

      // Also expose via callback when provided
      try {
        onDataReady && onDataReady(aggregated);
      } catch (cbErr) {
        console.warn("[AgentsChart] onDataReady callback threw an error:", cbErr);
      }

      setAgg(aggregated);

      // Prepare chart-friendly data preserving full precision for sorting/display decisions.
      const shaped = aggregated.map((row) => ({
        name: row.agent,
        value: row.total_cost, // keep precision; only round in tooltips/labels as needed
      }));

      // Only treat empty-state when there are no agents (length === 0), even if totals are zero.
      setData(shaped);
    } catch (e: any) {
      setError(e?.message || "Failed to load LLM cost distribution by agent.");
      setAgg([]);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [normalizeToAggregated, onDataReady]);

  React.useEffect(() => {
    load();
    return () => {
      controllerRef.current?.abort();
    };
  }, [load]);

  const theme = getOceanTheme();
  const gridStroke = "rgba(0,0,0,0.08)";
  const axisTick = "#6B7280";
  const barFill = theme.colors.primary;
  const barStroke = "#1E40AF";

  // Short USD formatter for axis/labels
  const numberToUsdShort = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1000) {
      try {
        return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
      } catch {
        return `$${Math.round(n)}`;
      }
    }
    // small values -> show 2 decimals for readability
    return `$${Number(n).toFixed(2)}`;
  };

  // Exact 6-decimal USD string for tooltip
  const usdFixed6 = (n: number) => {
    const v = Number(n);
    return `$${(Number.isFinite(v) ? v : 0).toFixed(6)}`;
  };

  const hasData = Array.isArray(data) && data.length > 0;

  return (
    <Card
      title={<span data-testid="agents-chart-title">{title}</span>}
      subtitle="Summed USD cost per agent (descending). Tooltip shows exact cost to 6 decimals."
      className="mb-4"
    >
      {loading ? (
        <LoadingState message="Loading agent cost distribution..." height={height} />
      ) : !hasData && error ? (
        <div style={{ minHeight: height }}>
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : !hasData ? (
        <div
          className="screen-center"
          style={{
            minHeight: height,
            color: theme.colors.muted,
            background:
              "linear-gradient(135deg, rgba(37,99,235,0.04) 0%, rgba(249,250,251,1) 100%)",
            border: `1px dashed ${theme.colors.border}`,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          aria-label="No agent cost data available."
          data-testid="agents-chart-empty"
        >
          No agent cost data available.
        </div>
      ) : (
        <div style={{ width: "100%", height }} data-testid="agents-chart">
          <ResponsiveContainer>
            <BarChart
              data={data}
              margin={{ top: 12, right: 24, bottom: 12, left: 12 }}
              aria-label="Bar chart of LLM cost by agent"
            >
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 12, fill: axisTick }}
                tickMargin={8}
                interval={0}
                height={46}
                label={{
                  value: "Agent Name",
                  position: "insideBottom",
                  offset: -2,
                  fill: axisTick,
                  fontSize: 12,
                }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: axisTick }}
                allowDecimals
                tickFormatter={(v) => numberToUsdShort(Number(v))}
                width={100}
                label={{
                  value: "Total Cost in USD",
                  angle: -90,
                  position: "insideLeft",
                  fill: axisTick,
                  fontSize: 12,
                }}
              />
              <Tooltip
                formatter={(v: any) => [usdFixed6(Number(v)), "Total Cost"]}
                wrapperStyle={{ outline: "none" }}
              />
              <Legend
                verticalAlign="top"
                height={24}
                wrapperStyle={{ fontSize: 12, color: axisTick }}
              />
              <Bar
                dataKey="value"
                name="Total Cost"
                fill={barFill}
                stroke={barStroke}
                radius={[8, 8, 0, 0]}
              >
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(v: any) => numberToUsdShort(Number(v))}
                  style={{ fontSize: 11, fill: theme.colors.text }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Expose aggregated JSON for QA tooling */}
          <pre
            data-testid="agents-chart-json"
            style={{ display: "none" }}
            aria-hidden="true"
          >
            {JSON.stringify(agg)}
          </pre>
        </div>
      )}
    </Card>
  );
}
