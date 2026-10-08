import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

try {
  const last = Number(readFileSync(join(tmpdir(), "preventbase-worker.heartbeat"), "utf8"));
  process.exit(Date.now() - last < 90_000 ? 0 : 1);
} catch {
  process.exit(1);
}
