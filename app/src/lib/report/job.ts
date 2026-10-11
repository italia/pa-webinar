/**
 * Il ciclo di vita del lavoro del resoconto (PostprodJob di tipo REPORT).
 *
 * Il claim calcola i numeri e li scrive nel payload. La consegna li prende,
 * salva il resoconto e chiude il lavoro come concluso, tutto nella stessa
 * transazione: un lavoro del resoconto e' concluso solo se il suo resoconto
 * e' salvato, e un lavoro chiuso (concluso o fallito) non si riapre.
 *
 * Dopo un lease scaduto due worker possono lavorare sullo stesso lavoro. Ogni
 * claim incrementa `attempts`, e il worker rimanda il numero del suo claim con
 * ogni messaggio: una scrittura vale solo se quel numero e' ancora quello del
 * lavoro, e lo verifica lo stesso UPDATE che scrive. Chi e' stato superato lo
 * legge nella risposta e si ferma; il testo e i numeri di un resoconto vengono
 * cosi' sempre dallo stesso claim. Ogni chiusura toglie i numeri nello stesso
 * UPDATE che cambia lo stato.
 */
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

type Db = Prisma.TransactionClient | typeof prisma;

/** Il lavoro, ancora aperto e ancora del claim `tentativo`. */
function delTentativo(jobId: string, tentativo: number): Prisma.Sql {
  return Prisma.sql`id = ${jobId}::uuid AND kind = 'REPORT'
    AND status IN ('PENDING', 'CLAIMED', 'RUNNING') AND attempts = ${tentativo}`;
}

/**
 * Scrive i numeri nel lavoro appena preso dal claim. Falso se nel frattempo
 * il lavoro si e' chiuso (un tentativo precedente l'ha consegnato).
 */
export async function scriviNumeriResoconto(
  jobId: string,
  tentativo: number,
  numeri: unknown,
  db: Db = prisma
): Promise<boolean> {
  const n = await db.$executeRaw`
    UPDATE postprod_jobs
    SET payload = payload || jsonb_build_object('metrics', ${JSON.stringify(numeri)}::jsonb), updated_at = NOW()
    WHERE ${delTentativo(jobId, tentativo)}
  `;
  return n > 0;
}

/**
 * La consegna: prende i numeri del lavoro, se e' ancora del claim `tentativo`,
 * e lo chiude come concluso, in un colpo solo. La riga resta bloccata fino
 * alla fine della transazione: se il resoconto non si salva, la transazione si
 * annulla e il lavoro resta aperto con i suoi numeri. Null se non c'e' niente
 * da prendere.
 */
export async function consegnaResoconto(jobId: string, tentativo: number, db: Db): Promise<Prisma.JsonValue | null> {
  const righe = await db.$queryRaw<Array<{ metrics: Prisma.JsonValue }>>`
    WITH presi AS (
      SELECT id, payload -> 'metrics' AS metrics
      FROM postprod_jobs
      WHERE ${delTentativo(jobId, tentativo)} AND jsonb_typeof(payload -> 'metrics') = 'object'
      FOR UPDATE
    )
    UPDATE postprod_jobs p
    SET status = 'DONE',
        completed_at = NOW(),
        last_error = NULL,
        leased_at = NULL,
        leased_by = NULL,
        payload = p.payload - 'metrics',
        updated_at = NOW()
    FROM presi
    WHERE p.id = presi.id
    RETURNING presi.metrics
  `;
  return righe[0]?.metrics ?? null;
}

/**
 * Lo stato del lavoro per il worker del claim `tentativo`: chiuso, superato da
 * un claim successivo, o ancora suo.
 */
export async function statoResoconto(
  jobId: string,
  tentativo: number | undefined
): Promise<{ status: string; superseded?: true }> {
  const lavoro = await prisma.postprodJob.findUnique({
    where: { id: jobId },
    select: { status: true, attempts: true },
  });
  if (!lavoro || lavoro.status === 'DONE' || lavoro.status === 'FAILED') {
    return { status: lavoro?.status ?? 'FAILED' };
  }
  return lavoro.attempts === tentativo ? { status: lavoro.status } : { status: lavoro.status, superseded: true };
}

/**
 * Un messaggio di avanzamento per un lavoro del resoconto, con la risposta
 * per il worker. Concluso lo dice solo la consegna (app/api/internal/event-report);
 * un messaggio senza il numero del claim non conta.
 */
export async function avanzamentoResoconto(
  job: { id: string; status: string; attempts: number },
  messaggio: {
    status: 'RUNNING' | 'DONE' | 'FAILED';
    error?: string;
    message?: string;
    workerId?: string;
    attempt?: number;
  },
  regole: { tentativiMassimi: () => Promise<number>; ritardoMs: number }
): Promise<{ status: string; superseded?: true; chiusoOra?: true }> {
  const tentativo = messaggio.attempt;
  if (job.status === 'DONE' || job.status === 'FAILED') return { status: job.status };
  if (messaggio.status === 'DONE' || !tentativo) {
    return job.attempts === tentativo ? { status: job.status } : { status: job.status, superseded: true };
  }
  const lavoro = delTentativo(job.id, tentativo);

  if (messaggio.status === 'RUNNING') {
    // Il lease si rinnova (e si riprende, se il lavoro era tornato in coda
    // senza che nessun altro lo prendesse).
    const n = await prisma.$executeRaw`
      UPDATE postprod_jobs
      SET status = 'RUNNING',
          started_at = COALESCE(started_at, NOW()),
          next_attempt_at = NOW() + INTERVAL '30 minutes',
          leased_by = COALESCE(${messaggio.workerId || null}, leased_by),
          leased_at = COALESCE(leased_at, NOW()),
          updated_at = NOW()
      WHERE ${lavoro}
    `;
    return n > 0 ? { status: 'RUNNING' } : statoResoconto(job.id, tentativo);
  }

  const errore = messaggio.error ?? messaggio.message ?? null;
  const definitivo = tentativo >= (await regole.tentativiMassimi());
  const n = definitivo
    ? await prisma.$executeRaw`
        UPDATE postprod_jobs
        SET status = 'FAILED', completed_at = NOW(), last_error = ${errore},
            leased_at = NULL, leased_by = NULL, next_attempt_at = NOW(),
            payload = payload - 'metrics', updated_at = NOW()
        WHERE ${lavoro}
      `
    : await prisma.$executeRaw`
        UPDATE postprod_jobs
        SET status = 'PENDING', last_error = ${errore},
            leased_at = NULL, leased_by = NULL,
            next_attempt_at = NOW() + ${regole.ritardoMs} * INTERVAL '1 millisecond',
            updated_at = NOW()
        WHERE ${lavoro}
      `;
  if (n === 0) return statoResoconto(job.id, tentativo);
  return definitivo ? { status: 'FAILED', chiusoOra: true } : { status: 'PENDING' };
}
