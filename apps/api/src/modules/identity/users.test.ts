import { beforeAll, describe, expect, it, vi } from "vitest";
import type { UsersController as UsersControllerType } from "./users.controller.js";

type Row = Record<string, any>;

let UsersController: typeof UsersControllerType;
let asActor: <T>(userId: string, fn: () => Promise<T>) => Promise<T>;

beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.BIOMETRIC_SERVICE_TOKEN = "test-token";
  ({ UsersController } = await import("./users.controller.js"));
  const { contextStorage } = await import("../../core/context.js");
  asActor = (userId, fn) =>
    contextStorage.run({ requestId: "test", userId, tenantId: "t1", sessionId: "s1", permissions: new Set(["users.manage", "users.view"]), companyIds: null }, fn);
}, 120_000);

vi.mock("../../core/prisma.service.js", () => ({ PrismaService: class {} }));
vi.mock("../../core/audit.service.js", () => ({ AuditService: class {} }));

function makeDb() {
  const roles = [
    { id: "r-admin", key: "company_admin", tenantId: null, permissions: [{ permission: { key: "users.manage" } }, { permission: { key: "users.view" } }] },
    { id: "r-tech", key: "sst_technician", tenantId: null, permissions: [{ permission: { key: "epi.deliver" } }] },
  ];
  const users: Row[] = [
    { id: "admin", tenantId: "t1", name: "Admin", status: "ACTIVE" },
    { id: "novo", tenantId: "t1", name: "Novo SSO", status: "BLOCKED" },
  ];
  const userRoles: Row[] = [{ userId: "admin", roleId: "r-admin", companyId: null, establishmentId: null }];
  const view = (u: Row) => ({ ...u, roles: userRoles.filter((r) => r.userId === u.id).map((r) => ({ companyId: r.companyId, role: { key: roles.find((x) => x.id === r.roleId)!.key } })) });
  const prisma: Row = {
    user: {
      findFirst: async ({ where }: Row) => {
        const u = users.find((x) => x.id === where.id && x.tenantId === where.tenantId);
        return u ? view(u) : null;
      },
      update: async ({ where, data }: Row) => {
        const u = users.find((x) => x.id === where.id)!;
        for (const [k, v] of Object.entries(data)) if (v !== undefined) u[k] = v;
        return view(u);
      },
    },
    role: { findMany: async ({ where }: Row) => roles.filter((r) => where.key.in.includes(r.key)) },
    userRole: {
      deleteMany: async ({ where }: Row) => {
        for (let i = userRoles.length - 1; i >= 0; i--) if (userRoles[i]!.userId === where.userId) userRoles.splice(i, 1);
      },
      createMany: async ({ data }: Row) => void userRoles.push(...data),
    },
    session: { updateMany: async () => ({ count: 0 }) },
    webauthnCredential: { deleteMany: async () => ({ count: 0 }) },
  };
  prisma.$transaction = async (fn: (tx: Row) => Promise<unknown>) => fn(prisma);
  const audit = { record: vi.fn(async () => undefined) };
  const guard = { invalidate: vi.fn() };
  const controller = new UsersController(prisma as never, audit as never, guard as never);
  return { controller, users, userRoles, audit, guard };
}

describe("liberação de usuários", () => {
  it("libera usuário pendente salvando perfil, escopo e ACTIVE numa operação só", async () => {
    const { controller, users, userRoles, audit, guard } = makeDb();
    const out = await asActor("admin", () => controller.update("novo", { status: "ACTIVE", roles: [{ roleKey: "sst_technician", companyId: "11111111-1111-4111-8111-111111111111" }] }));
    expect(out.status).toBe("ACTIVE");
    expect(users.find((u) => u.id === "novo")!.status).toBe("ACTIVE");
    expect(userRoles.filter((r) => r.userId === "novo")).toEqual([{ userId: "novo", roleId: "r-tech", companyId: "11111111-1111-4111-8111-111111111111", establishmentId: null }]);
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "user.updated", entityId: "novo" }));
    expect(guard.invalidate).toHaveBeenCalled();
  });

  it("admin não bloqueia a si mesmo", async () => {
    const { controller, users } = makeDb();
    await expect(asActor("admin", () => controller.update("admin", { status: "BLOCKED" }))).rejects.toMatchObject({ status: 400, code: "SELF_BLOCK" });
    expect(users.find((u) => u.id === "admin")!.status).toBe("ACTIVE");
  });

  it("admin não remove o próprio perfil de administrador", async () => {
    const { controller, userRoles } = makeDb();
    await expect(asActor("admin", () => controller.update("admin", { roles: [{ roleKey: "sst_technician" }] }))).rejects.toMatchObject({ status: 400, code: "SELF_ADMIN_REMOVAL" });
    await expect(asActor("admin", () => controller.update("admin", { roles: [] }))).rejects.toMatchObject({ code: "SELF_ADMIN_REMOVAL" });
    expect(userRoles.filter((r) => r.userId === "admin").map((r) => r.roleId)).toEqual(["r-admin"]);
  });

  it("admin pode trocar o próprio escopo mantendo um perfil com users.manage", async () => {
    const { controller, userRoles } = makeDb();
    await asActor("admin", () => controller.update("admin", { roles: [{ roleKey: "company_admin" }, { roleKey: "sst_technician" }] }));
    expect(userRoles.filter((r) => r.userId === "admin").map((r) => r.roleId)).toEqual(["r-admin", "r-tech"]);
  });

  it("bloquear outro usuário continua permitido", async () => {
    const { controller, users } = makeDb();
    await asActor("admin", () => controller.update("novo", { status: "BLOCKED" }));
    expect(users.find((u) => u.id === "novo")!.status).toBe("BLOCKED");
  });
});
