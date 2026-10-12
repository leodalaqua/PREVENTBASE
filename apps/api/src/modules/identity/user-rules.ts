import { DomainError } from "../../core/context.js";

/** Admin não bloqueia a si mesmo nem perde o próprio `users.manage` ao trocar os perfis. */
export function assertSelfUpdateAllowed(input: { actorId: string; targetId: string; status?: "ACTIVE" | "BLOCKED"; rolePermissions?: string[][] }): void {
  if (input.actorId !== input.targetId) return;
  if (input.status === "BLOCKED") throw new DomainError(400, "SELF_BLOCK", "Você não pode bloquear o próprio usuário");
  if (input.rolePermissions && !input.rolePermissions.some((p) => p.includes("users.manage"))) {
    throw new DomainError(400, "SELF_ADMIN_REMOVAL", "Você não pode remover o próprio perfil de administrador");
  }
}
