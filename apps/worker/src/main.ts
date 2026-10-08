import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverInterruptedCaepiSyncs } from "@preventbase/caepi";
import { createPrismaClient } from "@preventbase/database";
import { type Job, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { log, runAlerts, runAuditVerify, runCaepiSync, runStockReconcile } from "./jobs.js";

const QUEUE_NAME = "preventbase";
const TZ = "America/Sao_Paulo";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const caepiUrl = process.env.CAEPI_SOURCE_URL ?? "";
const heartbeatFile = join(tmpdir(), "preventbase-worker.heartbeat");

const prisma = createPrismaClient();
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue(QUEUE_NAME, { connection });

const SCHEDULES: Array<{ id: string; name: string; pattern: string }> = [
  { id: "alerts-hourly", name: "alerts", pattern: "5 * * * *" },
  { id: "audit-verify-daily", name: "audit-verify", pattern: "30 2 * * *" },
  { id: "stock-reconcile-daily", name: "stock-reconcile", pattern: "45 2 * * *" },
  ...(caepiUrl ? [{ id: "caepi-sync-daily", name: "caepi-sync", pattern: "15 4 * * *" }] : []),
];

async function handle(job: Job): Promise<unknown> {
  switch (job.name) {
    case "alerts":
      return runAlerts(prisma);
    case "audit-verify":
      return runAuditVerify(prisma);
    case "stock-reconcile":
      return runStockReconcile(prisma);
    case "caepi-sync": {
      if (!caepiUrl) throw new Error("CAEPI_SOURCE_URL não configurada");
      const result = await runCaepiSync(prisma, caepiUrl, (job.data as { triggeredBy?: string }).triggeredBy);
      await runAlerts(prisma);
      return result;
    }
    default:
      throw new Error(`Job desconhecido: ${job.name}`);
  }
}

async function main(): Promise<void> {
  const interrupted = await recoverInterruptedCaepiSyncs(prisma);
  if (interrupted > 0) log("warn", "sincronizações CAEPI interrompidas marcadas como FAILED", { count: interrupted });
  for (const s of SCHEDULES) {
    await queue.upsertJobScheduler(s.id, { pattern: s.pattern, tz: TZ }, { name: s.name, data: {}, opts: { removeOnComplete: 50, removeOnFail: 100 } });
  }
  if (!caepiUrl) await queue.removeJobScheduler("caepi-sync-daily").catch(() => undefined);

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const started = Date.now();
      log("info", "job iniciado", { job: job.name, id: job.id });
      const result = await handle(job);
      log("info", "job concluído", { job: job.name, id: job.id, ms: Date.now() - started });
      return result;
    },
    { connection, concurrency: 1, lockDuration: 15 * 60_000 },
  );
  worker.on("failed", (job, err) => log("error", "job falhou", { job: job?.name, id: job?.id, error: err.message }));

  const beat = () => writeFileSync(heartbeatFile, String(Date.now()));
  beat();
  const timer = setInterval(beat, 20_000);

  await queue.add("alerts", {}, { jobId: `alerts-boot-${new Date().toISOString().slice(0, 13)}`, removeOnComplete: 50, removeOnFail: 100 });
  log("info", "worker ativo", { schedules: SCHEDULES.map((s) => `${s.name}@${s.pattern}`) });

  const shutdown = async () => {
    clearInterval(timer);
    await worker.close();
    await queue.close();
    connection.disconnect();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log("error", "falha ao iniciar worker", { error: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
