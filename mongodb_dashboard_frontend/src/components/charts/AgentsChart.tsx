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
import { formatCurrencyAmount } from "../../utils/formatCurrency";
import { getOceanTheme } from "../../theme/oceanTheme";

// Types for incoming data and component props
type AgentCostItem = {
  agent?: string;
  agent_name?: string;
  name?: string;
  total_cost?: number | string;
  cost?: number | string;
  total?: number | string;
};

type AgentsChartProps = {
  title?: string;
  height?: number;
};

// PUBLIC_INTERFACE
/**
 * AgentsChart
 * Displays LLM cost distribution by agent. Internally fetches from /api/analytics/llm-cost-by-agent
 * using the shared apiGet utility. Handles loading, error, and empty states and renders a responsive
 * bar chart with Ocean Professional styling tokens.
 */
export default function AgentsChart({
  title = "LLM Cost by Agent",
  height = 360,
}: AgentsChartProps) {
  const [data, setData] = React.useState<Array<{ name: string; value: number }>>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string>("");

  const controllerRef = React.useRef<AbortController | null>(null);

  const load = React.useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError("");
    try {
      // Endpoint per backend OpenAPI: /api/analytics/llm-cost-by-agent
      const res = await apiGet<AgentCostItem[]>("/api/analytics/llm-cost-by-agent", {
        signal: controller.signal,
      });

      const toNumber = (v: any): number => {
        if (v == null || v === "") return 0;
        if (typeof v === "number") return Number.isFinite(v) ? v : 0;
        const s = String(v).replace(/[$,]/g, "").trim();
        const n = Number(s);
        return Number.isFinite(n) ? n : 0;
      };

      // Normalize keys: agent name across agent | agent_name | name
      const arr = Array.isArray(res) ? res : [];
      const shaped = arr
        .map((d: AgentCostItem) => {
          const name =
            (d.agent_name ?? d.agent ?? d.name ?? "Unknown").toString().trim() || "Unknown";
          const value = toNumber(
            // prefer total_cost; fallback to cost/total
            (d as any).total_cost ?? (d as any).cost ?? (d as any).total
          );
          return { name, value };
        })
        .filter((x) => Number.isFinite(x.value));

      // Compute total and check emptiness by sum
      const total = shaped.reduce((acc, r) => acc + (Number(r.value) || 0), 0);

      // Sort desc
      shaped.sort((a, b) => (b.value || 0) - (a.value || 0));

      setData(total > 0 ? shaped : []); // treat zero-sum as empty
    } catch (e: any) {
      setError(e?.message || "Failed to load LLM cost distribution by agent.");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

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

  const numberToUsdShort = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1000) {
      try {
        return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
      } catch {
        return `$${Math.round(n)}`;
      }
    }
    return formatCurrencyAmount(n, { currency: "USD", maximumFractionDigits: 2 });
  };

  const numberToUsdFull = (n: number) => {
    return formatCurrencyAmount(n, { currency: "USD", maximumFractionDigits: 6 });
  };

  return (
    <Card
      title={title}
      subtitle="Summed USD cost per agent (descending). Tooltip shows exact cost to 6 decimals."
      className="mb-4"
    >
      {loading ? (
        <LoadingState message="Loading agent cost distribution..." height={height} />
      ) : error ? (
        <div style={{ minHeight: height }}>
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : data.length === 0 ? (
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
          aria-label="No cost data to display"
        >
          No agent cost data to display.
        </div>
      ) : (
        <div style={{ width: "100%", height }}>
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
                  value: "Agent",
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
                width={80}
                label={{
                  value: "Total cost (USD)",
                  angle: -90,
                  position: "insideLeft",
                  fill: axisTick,
                  fontSize: 12,
                }}
              />
              <Tooltip
                formatter={(v: any) => [numberToUsdFull(Number(v)), "Total cost"]}
                wrapperStyle={{ outline: "none" }}
              />
              <Legend
                verticalAlign="top"
                height={24}
                wrapperStyle={{ fontSize: 12, color: axisTick }}
              />
              <Bar
                dataKey="value"
                name="Total cost"
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
        </div>
      )}
    </Card>
  );
}
