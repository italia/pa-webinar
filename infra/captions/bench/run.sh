#!/usr/bin/env bash
# Suite completa del banco di prova dei sottotitoli live.
#
# Variabili (tutte facoltative):
#   BENCH_WORK      cartella di lavoro per motore, modello, corpus e risultati
#   BENCH_PROFILE   "quick" (circa 15 minuti) o "full" (circa due ore)
#   BENCH_BUDGETS   budget di CPU da provare, separati da spazio, nella forma
#                   <vcpu>:<cpuset>, es. "4:8,9,20,21". Vuoto = nessun
#                   confinamento, un solo budget pari alle CPU visibili (il
#                   caso del Job in cluster, dove il limite lo mette il pod).
#   BENCH_SESSIONS  voci simultanee da provare, es. "1,2,4,8"
#   BENCH_DURATION  secondi di audio per voce nella prova in tempo reale
#   BENCH_PYTHON    interprete Python (default: python3)
#   BENCH_WER       0 per saltare la misura del WER per chunk
#   BENCH_CONTEXTS  contesti destri della prova in tempo reale, es. "3 6"
#
# Bash legge lo script mentre lo esegue: per lanciare la suite e intanto
# modificare i file, eseguirne una copia.
#
# Una vCPU in cloud è un thread hardware, non un core: su una macchina con
# SMT, per simulare 4 vCPU si confina il banco su due core e i loro gemelli
# (vedi /sys/devices/system/cpu/cpu*/topology/thread_siblings_list).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
py="${BENCH_PYTHON:-python3}"
export BENCH_WORK="${BENCH_WORK:-$PWD/work}"
profile="${BENCH_PROFILE:-quick}"
out="$BENCH_WORK/results/$(date +%Y%m%d-%H%M%S)-$profile"
mkdir -p "$out"

if [[ "$profile" == "full" ]]; then
  sessions="${BENCH_SESSIONS:-1,2,4,8,12,16}"
  duration="${BENCH_DURATION:-90}"
  contexts="${BENCH_CONTEXTS:-1 3 6}"
  wer_contexts="0,1,3,6,13"
  utterances=30
else
  sessions="${BENCH_SESSIONS:-1,2,4,8}"
  duration="${BENCH_DURATION:-45}"
  contexts="${BENCH_CONTEXTS:-3}"
  wer_contexts="1,3,6"
  utterances=15
fi

cd "$here"
budgets="${BENCH_BUDGETS:-}"
if [[ -z "$budgets" ]]; then
  # In un pod il budget è il limite di CPU del container, non le CPU del
  # nodo che il processo vede: più thread che quota vuol dire throttling.
  budgets="$("$py" -c 'import common, math, os; lim = common.cgroup_cpu_limit(); print(max(1, math.floor(lim)) if lim else len(os.sched_getaffinity(0)))'):"
fi

"$py" "$here/prepare.py"

# 1. Qualità per latenza: WER sulle frasi con il budget più grande, così il
#    calcolo non è il collo di bottiglia. BENCH_WER=0 la salta (per esempio
#    nei Job ripetuti per budget diversi sullo stesso tipo di nodo).
if [[ "${BENCH_WER:-1}" != "0" ]]; then
  last="${budgets##* }"
  vcpu="${last%%:*}"; cpus="${last#*:}"
  "$py" "$here/engine_sweep.py" --out "$out" --threads "$vcpu" \
    --right-context "$wer_contexts" --concurrency 1 ${cpus:+--cpus "$cpus"}
fi

for budget in $budgets; do
  vcpu="${budget%%:*}"; cpus="${budget#*:}"
  # 2. Costo per chunk di una voce e throughput con più voci, per budget.
  "$py" "$here/engine_sweep.py" --out "$out" --threads "$vcpu" --limit "$utterances" \
    --right-context "${contexts// /,}" --concurrency "1,$vcpu" ${cpus:+--cpus "$cpus"}
  # 3. Voci simultanee a ritmo reale: la misura che dimensiona il servizio.
  for rc in $contexts; do
    "$py" "$here/paced_load.py" --out "$out" --threads "$vcpu" --right-context "$rc" \
      --sessions "$sessions" --duration "$duration" ${cpus:+--cpus "$cpus"}
  done
done

"$py" "$here/report.py" "$out" | tee "$out/REPORT.md"
