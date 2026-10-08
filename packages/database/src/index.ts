import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";
export * from "./queries.js";
export * from "./audit.js";

export function createPrismaClient(url?: string): PrismaClient {
  return new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}
