# Organização e colaboradores

## Responsabilidade

Estrutura multiempresa (§6) e cadastro do colaborador como entidade central (§7): empresa → estabelecimento → unidade → setor; funções com matriz Função × EPI (§21).

## Regras

- Tudo é `tenantId` + escopo de empresa/estabelecimento do usuário (`companyScope`/`assertCompanyAccess` em `core/context.ts`).
- CPF/CNPJ validados por dígito (`packages/contracts/src/common.ts`); CPF único por tenant (409).
- Alteração de função/setor/status gera histórico com `changeReason` e `effectiveDate`; desligamento exige `terminationDate`.
- Requisitos de EPI da função (`PUT /jobs/:id/epi-requirements`) alimentam pendências, alertas `EPI_MISSING`/`EPI_OVERDUE` e o passo de itens da entrega.

## API

`/companies` · `/establishments` · `/units` · `/departments` · `/jobs` (+ `/jobs/:id/epi-requirements`) · `/employees` (+ `/:id/sst`, `/:id/timeline`, `/:id/epi-sheet`).

## Arquivos

`apps/api/src/modules/organization/` · `apps/api/src/modules/people/` · web: `(app)/colaboradores/`, `(app)/admin/` (abas Organização, Funções × EPI).
