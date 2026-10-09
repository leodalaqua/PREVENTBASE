# Relatórios, dashboard e busca

## Responsabilidade

Indicadores e exportações (§47-§50), busca global e notificações.

## Estado atual

- `/reports/deliveries|consumption|stock|movements|expiring-lots|pending|audit` com filtros de período/empresa/estabelecimento/setor/colaborador e `format=json|csv|xlsx|pdf`.
- `GET /dashboard`: cards (colaboradores, pendências, trocas vencidas, entregas do mês, estoque baixo, lotes a vencer/vencidos, alertas), série de 12 meses, recentes. Cards de ASO/treinamentos/acidentes/eSocial vêm `null` até as fases SST.
- `GET /search?q=` → colaboradores, EPIs, lotes, CA, documentos.
- Notificações (`/notifications`) geradas pelos alertas do worker (deduplicadas por `dedupeKey`).

## Arquivos

`apps/api/src/modules/reporting/` · `apps/api/src/modules/platform/platform.controller.ts` · web `(app)/page.tsx`, `(app)/relatorios/`, `(app)/busca/`, `(app)/alertas/`.
