import { createPrismaClient } from "./index.js";
import { runSeed } from "./seed.js";

const prisma = createPrismaClient();
runSeed(prisma, {
  tenantName: process.env.SEED_TENANT_NAME ?? "PreventBase",
  log: (m) => console.log(`[seed] ${m}`),
})
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("[seed] falhou", err);
    await prisma.$disconnect();
    process.exit(1);
  });
