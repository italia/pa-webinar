'use client';

import { useEffect, useState, useCallback } from 'react';

interface SparklineProps {
  metric: string;
  hours?: number;
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  label?: string;
  unit?: string;
  refreshSeconds?: number;
}

interface MetricResponse {
  available: boolean;
  metric: string;
  data?: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      values: Array<[number, string]>;
    }>;
  };
}

export default function PrometheusSparkline({
  metric,
  hours = 4,
  width = 200,
  height = 40,
  color = '#0066CC',
  fillOpacity = 0.15,
  label,
  unit = '',
  refreshSeconds = 60,
}: SparklineProps) {
  const [points, setPoints] = useState<Array<[number, number]>>([]);
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/status/metrics?metric=${metric}&hours=${hours}`);
      const data: MetricResponse = await res.json();

      if (!data.available) {
        setAvailable(false);
        return;
      }

      setAvailable(true);
      const raw = data.data?.result?.[0]?.values;
      if (!raw) { setAvailable(false); return; }
      const values = raw.map(
        ([ts, val]): [number, number] => [ts, parseFloat(val)],
      );
      setPoints(values);

      const lastPoint = values[values.length - 1];
      if (lastPoint) {
        setCurrentValue(lastPoint[1]);
      }
    } catch {
      setAvailable(false);
    }
  }, [metric, hours]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, refreshSeconds * 1000);
    return () => clearInterval(interval);
  }, [fetchData, refreshSeconds]);

  if (available === null) return null;
  if (!available || points.length < 2) return null;

  const values = points.map(p => p[1]);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const padding = 2;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;

  const pathPoints = points.map((p, i) => {
    const x = padding + (i / (points.length - 1)) * chartW;
    const y = padding + chartH - ((p[1] - minVal) / range) * chartH;
    return `${x},${y}`;
  });

  const linePath = `M ${pathPoints.join(' L ')}`;
  const fillPath = `${linePath} L ${padding + chartW},${padding + chartH} L ${padding},${padding + chartH} Z`;

  const formatValue = (v: number): string => {
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    if (v >= 100) return Math.round(v).toString();
    if (v >= 1) return v.toFixed(1);
    return v.toFixed(2);
  };

  return (
    <div className="d-inline-flex align-items-center gap-2" style={{ fontSize: '0.78rem' }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label ?? metric}
      >
        <path d={fillPath} fill={color} opacity={fillOpacity} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
      {currentValue !== null && (
        <span className="text-muted" style={{ whiteSpace: 'nowrap' }}>
          {formatValue(currentValue)}{unit}
        </span>
      )}
    </div>
  );
}

interface UptimeBadgeProps {
  uptime24h: number | null;
}

export function UptimeBadge({ uptime24h }: UptimeBadgeProps) {
  if (uptime24h === null) return null;

  const color = uptime24h >= 99.9 ? '#28a745' : uptime24h >= 99 ? '#ffc107' : '#dc3545';
  const textColor = uptime24h >= 99 && uptime24h < 99.9 ? '#000' : '#fff';

  return (
    <span
      className="badge rounded-pill"
      style={{ backgroundColor: color, color: textColor, fontSize: '0.72rem' }}
    >
      {uptime24h.toFixed(1)}% 24h
    </span>
  );
}

interface ResponseTimeBadgeProps {
  responseTimeMs: number | null;
}

export function ResponseTimeBadge({ responseTimeMs }: ResponseTimeBadgeProps) {
  if (responseTimeMs === null) return null;

  const color = responseTimeMs < 200 ? '#28a745' : responseTimeMs < 1000 ? '#ffc107' : '#dc3545';
  const textColor = responseTimeMs >= 200 && responseTimeMs < 1000 ? '#000' : '#fff';

  return (
    <span
      className="badge rounded-pill"
      style={{ backgroundColor: color, color: textColor, fontSize: '0.72rem' }}
    >
      P95: {responseTimeMs}ms
    </span>
  );
}
