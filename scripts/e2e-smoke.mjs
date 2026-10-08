// Smoke E2E dos fluxos críticos (MASTER-PLAN §80). Roda contra uma API e um banco DESCARTÁVEIS
// (scripts/e2e-smoke.ps1 cria preventbase_e2e e um container de API temporário). Nunca apontar para produção:
// o teste grava perfil/verificação biométrica sintéticos direto no banco para exercitar a entrega.
import { randomUUID } from "node:crypto";

const API = process.env.E2E_API ?? "http://127.0.0.1:3199/api/v1";
const DB_URL = process.env.E2E_DATABASE_URL;
const EMAIL = process.env.E2E_EMAIL ?? "admin@preventbase.local";
const PASSWORD = process.env.E2E_PASSWORD;
if (!DB_URL?.includes("preventbase_e2e") || !PASSWORD) {
  console.error("E2E_DATABASE_URL (banco preventbase_e2e) e E2E_PASSWORD são obrigatórios");
  process.exit(2);
}
process.env.DATABASE_URL = DB_URL;
const { createPrismaClient } = await import("../packages/database/dist/index.js");
const prisma = createPrismaClient();

let token = "";
const deviceKey = `e2e-${randomUUID()}`;
const results = [];

async function call(method, path, body, extra = {}) {
  const headers = { "x-device-key": deviceKey, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(extra.headers ?? {}) };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, type, data };
}

async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`  FAIL ${name}: ${err.message}`);
  }
}

function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}
function expectStatus(r, ...codes) {
  expect(codes.includes(r.status), `HTTP ${r.status} (esperado ${codes.join("/")}): ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
}

function cpf() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const len of [9, 10]) {
    const sum = n.slice(0, len).reduce((s, d, i) => s + d * (len + 1 - i), 0);
    const r = (sum * 10) % 11;
    n.push(r === 10 ? 0 : r);
  }
  return n.join("");
}
function cnpj() {
  const n = [...Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)), 0, 0, 0, 1];
  for (const w of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const r = n.reduce((s, d, i) => s + d * w[i], 0) % 11;
    n.push(r < 2 ? 0 : 11 - r);
  }
  return n.join("");
}
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

const s = {};

console.log(`PreventBase E2E -> ${API}`);

await step("health + ready", async () => {
  expectStatus(await call("GET", "/health"), 200);
  expectStatus(await call("GET", "/ready"), 200);
});

await step("login inválido recusado", async () => {
  expectStatus(await call("POST", "/auth/login", { email: EMAIL, password: "senha-errada-123" }), 401);
});

await step("login", async () => {
  const d = expectStatus(await call("POST", "/auth/login", { email: EMAIL, password: PASSWORD }), 200, 201);
  token = d.accessToken;
  expect(token, "sem accessToken");
  s.user = await prisma.user.findFirstOrThrow({ where: { email: EMAIL } });
});

await step("rota protegida sem token = 401", async () => {
  const t = token;
  token = "";
  expectStatus(await call("GET", "/employees"), 401);
  token = t;
});

await step("dispositivo registrado e aprovado", async () => {
  const d = expectStatus(await call("POST", "/devices/register", { deviceKey, name: "E2E" }), 200, 201);
  expectStatus(await call("PATCH", `/devices/${d.id}`, { status: "TRUSTED" }), 200);
});

await step("organização (empresa, estabelecimento, setor, função)", async () => {
  s.company = expectStatus(await call("POST", "/companies", { legalName: "E2E Indústria Ltda", cnpj: cnpj() }), 200, 201);
  s.est = expectStatus(await call("POST", "/establishments", { companyId: s.company.id, name: "Matriz E2E" }), 200, 201);
  s.dep = expectStatus(await call("POST", "/departments", { establishmentId: s.est.id, name: "Produção" }), 200, 201);
  s.job = expectStatus(await call("POST", "/jobs", { companyId: s.company.id, name: "Operador" }), 200, 201);
});

await step("colaborador + CPF duplicado recusado", async () => {
  const doc = cpf();
  const body = { companyId: s.company.id, establishmentId: s.est.id, departmentId: s.dep.id, jobId: s.job.id, name: "Fulano E2E da Silva", cpf: doc, admissionDate: day(-30) };
  s.emp = expectStatus(await call("POST", "/employees", body), 200, 201);
  expectStatus(await call("POST", "/employees", body), 409, 422);
});

await step("EPI com CA e variação", async () => {
  s.epi = expectStatus(await call("POST", "/epis", { internalCode: `E2E-${Date.now()}`, description: "Luva de vaqueta E2E", category: "Luvas", caNumber: "99901", replacementDays: 30, variants: [{ size: "M" }] }), 200, 201);
  s.variant = s.epi.variants[0];
  await prisma.caMaster.upsert({
    where: { caNumber: "99901" },
    update: {},
    create: { caNumber: "99901", validUntil: new Date(day(365)), situation: "VÁLIDO", manufacturerName: "Fabricante E2E", rowHash: "e2e", syncedAt: new Date() },
  });
});

await step("almoxarifado", async () => {
  s.wh = expectStatus(await call("POST", "/stock/warehouses", { establishmentId: s.est.id, name: "Central E2E", code: `E2E${Date.now() % 100000}` }), 200, 201);
});

await step("entradas de 2 lotes + idempotência", async () => {
  const base = { warehouseId: s.wh.id, variantId: s.variant.id, caNumber: "99901", purchaseDate: day(0) };
  const key = randomUUID();
  const a = expectStatus(await call("POST", "/stock/entries", { ...base, lotNumber: "LOTE-LONGO", expiryDate: day(300), quantity: 10 }, { headers: { "idempotency-key": key } }), 200, 201);
  const again = expectStatus(await call("POST", "/stock/entries", { ...base, lotNumber: "LOTE-LONGO", expiryDate: day(300), quantity: 10 }, { headers: { "idempotency-key": key } }), 200, 201);
  expect(a.movementId === again.movementId, "replay de entrada gerou novo movimento");
  const b = expectStatus(await call("POST", "/stock/entries", { ...base, lotNumber: "LOTE-CURTO", expiryDate: day(40), quantity: 5 }, { headers: { "idempotency-key": randomUUID() } }), 200, 201);
  s.lotLong = a.lot;
  s.lotShort = b.lot;
  const bal = await prisma.stockBalance.aggregate({ where: { warehouseId: s.wh.id, lotId: s.lotLong.id }, _sum: { quantity: true } });
  expect(bal._sum.quantity === 10, `saldo lote longo ${bal._sum.quantity} (esperado 10)`);
});

await step("FEFO sugere o lote que vence antes", async () => {
  const d = expectStatus(await call("GET", `/stock/fefo?warehouseId=${s.wh.id}&variantId=${s.variant.id}&quantity=1`), 200);
  expect(d.suggestion?.lotId === s.lotShort.id, "FEFO não escolheu LOTE-CURTO");
});

await step("estoque negativo bloqueado", async () => {
  const r = await call("POST", "/stock/adjustments", { warehouseId: s.wh.id, lotId: s.lotShort.id, type: "ADJUSTMENT_OUT", quantity: 999, reason: "teste negativo" });
  expect(r.status >= 400 && r.status < 500, `ajuste negativo aceito (HTTP ${r.status})`);
});

const items = () => [{ variantId: s.variant.id, quantity: 1, reasonCode: "INITIAL" }];

await step("entrega bloqueada sem biometria cadastrada", async () => {
  const d = expectStatus(await call("POST", "/deliveries/prepare", { employeeId: s.emp.id, warehouseId: s.wh.id, items: items() }), 200, 201);
  expect(d.ok === false && d.errors.some((e) => /biometria/i.test(e)), "prepare deveria exigir biometria");
});

async function syntheticVerification() {
  const id = `e2e-ver-${randomUUID()}`;
  await prisma.biometricVerification.create({
    data: { tenantId: s.user.tenantId, employeeId: s.emp.id, externalVerificationId: id, purpose: "DELIVERY", verified: true, score: 0.71, liveness: true, challengeAction: "TURN_LEFT", requestedById: s.user.id },
  });
  return id;
}

await step("prepare com biometria aponta lote FEFO", async () => {
  await prisma.biometricProfile.create({
    data: { tenantId: s.user.tenantId, employeeId: s.emp.id, externalProfileId: `e2e-${randomUUID()}`, quality: 0.9, purpose: "EPI_DELIVERY", legalBasis: "teste", enrolledById: s.user.id },
  });
  const d = expectStatus(await call("POST", "/deliveries/prepare", { employeeId: s.emp.id, warehouseId: s.wh.id, items: items() }), 200, 201);
  expect(d.ok, `prepare não ok: ${JSON.stringify([d.errors, d.items.map((i) => i.errors)])}`);
  expect(d.items[0].lot.id === s.lotShort.id, "prepare não usou LOTE-CURTO");
  s.termsVersion = d.terms.version;
});

await step("entrega sem Idempotency-Key recusada", async () => {
  const r = await call("POST", "/deliveries", { employeeId: s.emp.id, warehouseId: s.wh.id, items: items(), termsVersion: s.termsVersion, confirmed: true, biometricVerificationId: await syntheticVerification() });
  expectStatus(r, 400);
});

await step("entrega confirmada + replay idempotente + troca antecipada + biometria de uso único", async () => {
  const ver = await syntheticVerification();
  const key = randomUUID();
  const body = { employeeId: s.emp.id, warehouseId: s.wh.id, items: items(), termsVersion: s.termsVersion, confirmed: true, biometricVerificationId: ver };
  const d = expectStatus(await call("POST", "/deliveries", body, { headers: { "idempotency-key": key } }), 200, 201);
  expect(d.publicId && /^[0-9a-f]{64}$/.test(d.hash), "entrega sem publicId/hash");
  s.delivery = d;
  const replay = expectStatus(await call("POST", "/deliveries", body, { headers: { "idempotency-key": key } }), 200, 201);
  expect(replay.replayed === true && replay.id === d.id, "replay não devolveu a mesma entrega");
  const early = expectStatus(await call("POST", "/deliveries", body, { headers: { "idempotency-key": randomUUID() } }), 422);
  expect(/antecipada/i.test(early.message), "troca antecipada sem motivo deveria ser recusada");
  const damaged = { ...body, items: [{ variantId: s.variant.id, quantity: 1, reasonCode: "DAMAGE", justification: "Luva rasgada em operação" }] };
  const reused = expectStatus(await call("POST", "/deliveries", damaged, { headers: { "idempotency-key": randomUUID() } }), 409);
  expect(reused.code === "BIOMETRIC_REPLAY", `esperado BIOMETRIC_REPLAY, veio ${reused.code}`);
  const bal = await prisma.stockBalance.aggregate({ where: { warehouseId: s.wh.id, lotId: s.lotShort.id }, _sum: { quantity: true } });
  expect(bal._sum.quantity === 4, `saldo LOTE-CURTO ${bal._sum.quantity} (esperado 4)`);
});

await step("verificação pública (sem login) valida hash", async () => {
  const t = token;
  token = "";
  const d = expectStatus(await call("GET", `/public/verify/${s.delivery.publicId}`), 200);
  token = t;
  expect(d.found && d.valid && d.hashValid, `verificação inválida: ${JSON.stringify(d)}`);
  expect(!d.employee?.includes("Fulano E2E da Silva"), "nome não mascarado");
});

await step("PDF de evidência", async () => {
  const r = await call("GET", `/deliveries/${s.delivery.id}/pdf`);
  expectStatus(r, 200);
  expect(r.type.includes("pdf") && r.data.subarray(0, 4).toString() === "%PDF", "não é PDF");
});

await step("imutabilidade no banco (triggers)", async () => {
  const attempts = [
    ["UPDATE epi_deliveries SET \"deliveredAt\" = now() - interval '1 day' WHERE id = $1::uuid", s.delivery.id],
    ["UPDATE stock_movements SET quantity = quantity + 1 WHERE \"lotId\" = $1::uuid", s.lotShort.id],
    ["DELETE FROM audit_logs WHERE \"tenantId\" = $1::uuid", s.user.tenantId],
  ];
  for (const [sql, arg] of attempts) {
    let blocked = false;
    try {
      await prisma.$executeRawUnsafe(sql, arg);
    } catch {
      blocked = true;
    }
    expect(blocked, `não bloqueado: ${sql.slice(0, 40)}`);
  }
});

await step("devolução REUSABLE/GOOD volta ao estoque", async () => {
  expectStatus(await call("POST", "/returns", { employeeId: s.emp.id, variantId: s.variant.id, lotId: s.lotShort.id, warehouseId: s.wh.id, quantity: 1, condition: "GOOD", reason: "teste e2e", destination: "REUSABLE" }), 200, 201);
  const bal = await prisma.stockBalance.aggregate({ where: { warehouseId: s.wh.id, lotId: s.lotShort.id }, _sum: { quantity: true } });
  expect(bal._sum.quantity === 5, `saldo após devolução ${bal._sum.quantity} (esperado 5)`);
});

await step("documento: upload + download", async () => {
  const fd = new FormData();
  const content = `e2e ${randomUUID()}`;
  fd.append("file", new Blob([content], { type: "text/plain" }), "e2e.txt");
  fd.append("entityType", "EMPLOYEE");
  fd.append("entityId", s.emp.id);
  fd.append("title", "Documento E2E");
  const doc = expectStatus(await call("POST", "/documents", fd), 200, 201);
  const r = await call("GET", `/documents/${doc.id}/versions/1/download`);
  expectStatus(r, 200);
  expect(r.data.toString() === content, "conteúdo baixado difere");
});

await step("relatórios (json, csv, xlsx, pdf)", async () => {
  expectStatus(await call("GET", "/reports/deliveries?format=json"), 200);
  for (const [fmt, sig] of [["csv", null], ["xlsx", "PK"], ["pdf", "%PDF"]]) {
    const r = await call("GET", `/reports/deliveries?format=${fmt}`);
    expectStatus(r, 200);
    if (sig) expect(r.data.subarray(0, sig.length).toString() === sig, `${fmt} inválido`);
  }
});

await step("dashboard + busca", async () => {
  const d = expectStatus(await call("GET", "/dashboard"), 200);
  expect(d.cards.deliveredThisMonth >= 1, "dashboard sem a entrega");
  const b = expectStatus(await call("GET", "/search?q=LOTE-CURTO"), 200);
  expect(b.lots.length >= 1, "busca não achou lote");
});

await step("cancelamento da entrega", async () => {
  expectStatus(await call("POST", `/deliveries/${s.delivery.id}/cancel`, { reason: "teste de cancelamento e2e" }), 200, 201);
  const d = expectStatus(await call("GET", `/public/verify/${s.delivery.publicId}`), 200);
  expect(d.status === "CANCELLED", `status ${d.status}`);
});

await step("cadeia de auditoria íntegra", async () => {
  const d = expectStatus(await call("GET", "/audit/verify-chain"), 200);
  expect(d.ok && d.checked > 10, `cadeia: ${JSON.stringify(d)}`);
});

await prisma.$disconnect();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} ok`);
process.exit(failed.length ? 1 : 0);
