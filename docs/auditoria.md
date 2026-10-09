# Auditoria, imutabilidade e LGPD

## Responsabilidade

Trilha de auditoria à prova de adulteração (§51), registros legais imutáveis e base LGPD (§52, §57, §82).

## Regras

- `AuditService.record(tx, ...)` dentro da mesma transação da mudança; cadeia de hash por tenant (`prevHash` → `hash`, advisory lock). Cálculo/verificação compartilhados em `packages/database/src/audit.ts`.
- `GET /audit/verify-chain` e job diário `audit-verify` (02:30) → alerta `AUDIT_CHAIN_BROKEN`.
- Triggers (`migrations/*_integrity`): sem UPDATE/DELETE em `audit_logs`, `stock_movements`, `epi_delivery_items`, `delivery_evidence`, `document_versions`, `employee_history`, `ca_history`, `epi_return_steps`; sem DELETE em entregas, devoluções, documentos, lotes e biometria; `epi_deliveries` só aceita cancelamento e `biometric_verifications` só o consumo. `CHECK` de saldo não negativo.
- LGPD: `GET /lgpd/processing-records` (finalidade, categoria, base legal, origem, controlador, retenção). Biometria com base legal registrada no cadastro; template fora do banco principal.
- Leitura externa (`preventbase_leitura`, pg-gateway) vê todo o banco, inclusive CPF — liberar só para o círculo interno.

## Arquivos

`apps/api/src/core/audit.service.ts` · `packages/database/src/audit.ts` · `packages/database/prisma/migrations/` · web `(app)/auditoria/`.
