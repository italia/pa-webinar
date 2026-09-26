/**
 * Come si seleziona in Prometheus la serie `up` dell'applicazione.
 *
 * `up` la sintetizza Prometheus e porta solo le etichette del bersaglio (job,
 * namespace, pod…), non quelle che l'applicazione mette sulle proprie
 * metriche: filtrarla per `app` non trova mai niente. Il ServiceMonitor del
 * chart chiama il job come il Service, cioè il nome completo della release, e
 * il chart lo passa all'applicazione in `METRICS_JOB` — la stessa selezione
 * delle regole di allerta del chart.
 */

type Env = Record<string, string | undefined>;

/** Solo i caratteri di un nome Kubernetes: il valore finisce dentro una query. */
function labelValue(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]/g, '');
}

/** Il namespace dell'applicazione, come lo scrive il chart. */
export function metricsNamespace(env: Env = process.env): string {
  return labelValue(env.POD_NAMESPACE || 'default');
}

/**
 * Il selettore della serie `up` dell'applicazione. Senza `METRICS_JOB` (chart
 * precedenti) resta la selezione per nome di job di prima.
 */
export function upSelector(env: Env = process.env): string {
  const ns = metricsNamespace(env);
  const job = env.METRICS_JOB ? labelValue(env.METRICS_JOB) : '';
  return job ? `up{namespace="${ns}",job="${job}"}` : `up{namespace="${ns}",job=~".*eventi.*"}`;
}
