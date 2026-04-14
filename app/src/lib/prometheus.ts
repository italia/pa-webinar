const PROMETHEUS_URL = process.env['PROMETHEUS_URL'] || '';

export function isPrometheusConfigured(): boolean {
  return PROMETHEUS_URL.length > 0;
}

export interface PrometheusInstantResult {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      value: [number, string];
    }>;
  };
}

export interface PrometheusRangeResult {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      values: Array<[number, string]>;
    }>;
  };
}

export async function queryPrometheus(
  query: string,
  timeoutMs = 10000,
): Promise<PrometheusInstantResult> {
  if (!PROMETHEUS_URL) {
    throw new Error('PROMETHEUS_URL not configured');
  }
  const url = new URL('/api/v1/query', PROMETHEUS_URL);
  url.searchParams.set('query', query);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Prometheus query failed: ${res.status}`);
  return res.json() as Promise<PrometheusInstantResult>;
}

export async function queryPrometheusRange(
  query: string,
  start: string,
  end: string,
  step: string,
  timeoutMs = 15000,
): Promise<PrometheusRangeResult> {
  if (!PROMETHEUS_URL) {
    throw new Error('PROMETHEUS_URL not configured');
  }
  const url = new URL('/api/v1/query_range', PROMETHEUS_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('start', start);
  url.searchParams.set('end', end);
  url.searchParams.set('step', step);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Prometheus range query failed: ${res.status}`);
  return res.json() as Promise<PrometheusRangeResult>;
}
