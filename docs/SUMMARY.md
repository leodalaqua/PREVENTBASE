# PreventBase - SUMMARY

## Responsabilidade

Plataforma central de SST multiempresa com o colaborador como entidade principal. Fase 1: gestão completa de EPI (estoque por lote, CAEPI, entrega com biometria facial, ficha eletrônica, auditoria). eSocial **somente leitura/importação**. Operado por gestor/técnico/RH/líder; colaborador não precisa de celular.

Status: **planejado** - sem código. Fonte do produto: [MASTER-PLAN.md](MASTER-PLAN.md) (referenciar por `§N`).

## Stack (alvo)

Next.js PWA · NestJS (modular monolith) · PostgreSQL · Redis/BullMQ · MinIO · biometric-service (Python/FastAPI, isolado) · nginx · Docker (`docker-compose.yml`) - [MASTER-PLAN §4-§5](MASTER-PLAN.md#4-arquitetura-geral)

## Módulos

Docs de módulo são criados junto com o código de cada módulo. Até lá, a seção do plano mestre é a referência.

| Módulo | Doc |
|--------|-----|
| Organização / multiempresa / colaboradores | [MASTER-PLAN §6-§7](MASTER-PLAN.md#6-multiempresa) |
| Identidade, perfis, permissões, dispositivos | §53-§56 |
| EPI, CA/CAEPI | §17-§19 |
| Estoque, lotes, almoxarifados, inventário | §14-§16, §27-§28 |
| Entrega, devolução, ficha, evidência | §9-§13, §29, §65-§66 |
| Biometria | §8 |
| Riscos, PGR, matriz Função × EPI, kits | §20-§22, §36 |
| Treinamentos | §31 |
| Saúde ocupacional | §33-§35 |
| Acidentes | §37 |
| eSocial (somente leitura) | §38-§44 |
| Documentos | §45-§46 |
| Auditoria, LGPD | §51-§52, §57, §82 |

## Invariantes

`.cursor/rules/10-preventbase-invariants.mdc` (sempre aplicada) - resumo de §0 e §79.

## Integrações

Nenhuma ativa. Previstas: base CAEPI/MTE (§18), eSocial download/consulta (§39-§40), `EmployeeProvider` RH (§69).

## Portas

id 31 em `C:\ROBBY\config\ports.json`: web `:3100`, api `:3101` (reservadas). Demais previstas em [MASTER-PLAN §5](MASTER-PLAN.md#5-docker); registrar no hub no scaffold (regra `40-hub-ports`).
