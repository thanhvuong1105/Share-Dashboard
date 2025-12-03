import React from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

type PnlPoint = {
  date: string;   // ví dụ "11-20"
  pnl: number;    // PnL trong ngày
  cumPnl: number; // PnL lũy kế
};

// TODO: sau này thay bằng data thật từ OKX/Firebase
const mockPnlHistory: PnlPoint[] = [
  { date: "11-20", pnl: 120, cumPnl: 120 },
  { date: "11-21", pnl: -80, cumPnl: 40 },
  { date: "11-22", pnl: 50, cumPnl: 90 },
  { date: "11-23", pnl: 200, cumPnl: 290 },
  { date: "11-24", pnl: -40, cumPnl: 250 },
  { date: "11-25", pnl: 30, cumPnl: 280 },
  { date: "11-26", pnl: 70, cumPnl: 350 },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || payload.length === 0) return null;

  const dayPnl = payload.find((p: any) => p.dataKey === "pnl");
  const cumPnl = payload.find((p: any) => p.dataKey === "cumPnl");

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950/95 px-3 py-2 text-xs text-neutral-100 shadow-xl">
      <div className="text-[11px] text-neutral-400 mb-1">
        Ngày: <span className="text-neutral-100">{label}</span>
      </div>
      {dayPnl && (
        <div className="flex justify-between gap-4">
          <span className="text-neutral-400">PnL ngày</span>
          <span
            className={
              dayPnl.value >= 0
                ? "text-emerald-400 font-medium"
                : "text-red-400 font-medium"
            }
          >
            {dayPnl.value >= 0
              ? `+${dayPnl.value.toFixed(2)}`
              : dayPnl.value.toFixed(2)}
          </span>
        </div>
      )}
      {cumPnl && (
        <div className="flex justify-between gap-4">
          <span className="text-neutral-400">PnL lũy kế</span>
          <span
            className={
              cumPnl.value >= 0
                ? "text-emerald-400 font-medium"
                : "text-red-400 font-medium"
            }
          >
            {cumPnl.value >= 0
              ? `+${cumPnl.value.toFixed(2)}`
              : cumPnl.value.toFixed(2)}
          </span>
        </div>
      )}
      <div className="mt-1 text-[10px] text-neutral-500">
        * PnL chốt lúc 23:00 (VN)
      </div>
    </div>
  );
};

const PnlHistoryChart: React.FC = () => {
  return (
    <div className="w-full h-64 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[12px] font-medium text-neutral-100">
            PnL History (Daily)
          </div>
          <div className="text-[11px] text-neutral-500">
            PnL theo ngày &amp; PnL lũy kế – chốt 23:00 VN
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={mockPnlHistory}
          margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            axisLine={{ stroke: "#3f3f46" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            axisLine={{ stroke: "#3f3f46" }}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Bar: PnL theo ngày */}
          <Bar
            dataKey="pnl"
            barSize={14}
            radius={[4, 4, 0, 0]}
            fill="#22c55e"
          />

          {/* Line: PnL lũy kế */}
          <Line
            type="monotone"
            dataKey="cumPnl"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PnlHistoryChart;
