# PreventBase — Plano Mestre (oficial)

Status: **oficial** · aprovado em 07/10/2026 · fonte única do produto. Mudanças de escopo/arquitetura → editar este arquivo (registrar no histórico ao final).

Numeração `§N` é estável: código, PRs e docs de módulo referenciam por ela (ex.: "ver §19").

---

## 0. Decisões consolidadas (não negociáveis)

1. **Hub de SST, não CRUD de fichas.** Estoque, CA, biometria, risco, função, treinamento, saúde, documentos, auditoria e eSocial compartilham **um único modelo de dados**. Novos subsistemas nascem sobre ele, sem reconstruir arquitetura.
2. **Colaborador como entidade central** (§2, §7, §87).
3. **Operado por gestor / técnico SST / RH / líder / almoxarife.** O colaborador **não precisa de celular**: confirma no aparelho do responsável ou em terminal (§9, §10).
4. **Entrega de EPI com biometria facial 1:1 + liveness + ato explícito de confirmação** (§8–§11).
5. **eSocial somente leitura/importação. Nunca transmissão** — proteção arquitetural (§38–§41).
6. **CA válido na compra ≠ CA válido hoje** — não bloquear entrega por vencimento posterior do CA (§3, §19).
7. **Modular monolith** (NestJS) + serviços isolados só para biometria, workers e storage (§86).
8. Regras obrigatórias de programação: §79 (espelhadas em `.cursor/rules/10-preventbase-invariants.mdc`).

---

## 1. Visão do produto

Plataforma central de SST com o colaborador como entidade principal, conectando: gestão de EPI, estoque, CA, entrega/devolução, biometria facial, treinamentos, riscos ocupacionais, PGR, saúde ocupacional, exames/ASO, acidentes, documentos, vencimentos, auditorias, dashboards, eSocial (somente leitura), integrações e futuros subsistemas.

Primeira grande função operacional: **gestão completa de EPIs**. Arquitetura já preparada para virar o hub de SST da empresa.

## 2. Princípio central

```
Empresa → Unidade → Setor → Função → Colaborador → Riscos → EPIs → Entregas → Treinamentos → Saúde → Documentos → eSocial
```

Abrir o colaborador = enxergar todo o histórico de SST.

## 3. Fundamentação da entrega eletrônica (NR-6)

NR-6 admite registro do fornecimento em sistema eletrônico, inclusive biométrico, e exige extração de relatórios. O PreventBase produz **cadeia de evidências robusta**.

Cada entrega registra no mínimo: colaborador, empresa, estabelecimento, setor, função, EPI, CA, fabricante, lote, validade, quantidade, motivo, data/hora, gestor responsável, dispositivo, forma de confirmação, resultado da validação biométrica, evidências, hash, histórico de alterações, IP e sessão (quando disponíveis).

CA deve estar válido na aquisição/comercialização; após adquirido, o fornecimento observa armazenamento e validade do fabricante/importador. **Não bloquear entrega porque o CA venceu depois da compra** (modelagem em §19).

## 4. Arquitetura geral

```
preventbase/
├── apps/
│   ├── web/                 # Next.js PWA
│   ├── api/                 # NestJS (modular monolith)
│   ├── worker/              # BullMQ
│   └── biometric-service/   # Python + FastAPI (isolado)
├── packages/
│   ├── ui/  types/  contracts/  permissions/  validation/
│   └── esocial-readonly/    # §41
├── infrastructure/
│   ├── docker/  nginx/  postgres/  redis/  minio/
├── docs/
│   ├── architecture/ database/ api/ security/ esocial/ biometric/ compliance/
└── docker-compose.yml
```

| Camada | Stack |
|--------|-------|
| Frontend | Next.js, React, TypeScript, Tailwind, shadcn/ui, PWA, React Query, Zod |
| Backend | NestJS, TypeScript, REST, OpenAPI/Swagger, Prisma ou TypeORM (decidir no scaffold) |
| Banco | PostgreSQL |
| Filas/cache | Redis + BullMQ |
| Arquivos | MinIO / S3 |
| Biometria | Python + FastAPI, serviço isolado atrás de interface substituível |

## 5. Docker

Desde o primeiro commit: `preventbase-web`, `preventbase-api`, `preventbase-worker`, `preventbase-biometric`, `preventbase-postgres`, `preventbase-redis`, `preventbase-minio`, `preventbase-nginx`. Sobe com `docker compose up -d`. Nenhum serviço essencial instalado direto no host.

Portas (padrão ROBBY `id*100+role`, id 31) — reservadas no hub: web `:3100`, api `:3101`. Previstas no scaffold (registrar no hub via regra `40-hub-ports`): postgres `:3110` (+ `pgReader` `preventbase_leitura`), minio API/console `:3112`/`:3113`. Redis, worker e biometric somente em rede interna.

## 6. Multiempresa

```
Grupo empresarial └ Empresa └ Estabelecimento └ Unidade └ Setor └ Função └ Colaborador
```

Tabelas transacionais com `tenant_id`, `company_id`, `establishment_id`.

## 7. Colaboradores (núcleo)

- **Cadastro:** nome, CPF, matrícula, nascimento, admissão, empresa, estabelecimento, setor, função, CBO, gestor, status, foto, e-mail, telefone.
- **Aba SST:** riscos, EPIs obrigatórios, EPIs entregues, treinamentos, exames, ASOs, acidentes, restrições, documentos, pendências, eSocial.
- **Timeline única** (EPI entregue, treinamento, ASO, troca de função, substituição…).

## 8. Cadastro biométrico

Fluxo: captura facial → qualidade → detecção de rosto → liveness → template → criptografia → cadastro.

**Foto cadastral ≠ template biométrico.** Biometria é dado sensível (LGPD): criptografia em repouso e trânsito, controle de acesso, logs, segregação, retenção, finalidade, base legal registrada, revogação/substituição do template.

Backend principal **não acessa o template**; recebe apenas:

```json
{ "verified": true, "score": 0.91, "liveness": true, "verification_id": "..." }
```

## 9. Entrega de EPI (fluxo principal do MVP)

Gestor entra → seleciona colaborador → sistema mostra EPIs obrigatórios → seleciona EPI → seleciona lote → valida estoque → valida produto → valida CA → valida validade → solicita confirmação → captura facial → liveness → comparação 1:1 → confirmação do colaborador → baixa de estoque → registro → hash → auditoria → ficha atualizada.

Dispositivos: celular do técnico/líder/RH, tablet, terminal de entrega. Colaborador sem celular.

## 10. Tela de confirmação

Texto (versionado — `terms_version`):

> Confirmo o recebimento dos equipamentos de proteção individual relacionados nesta entrega e declaro ter recebido as orientações aplicáveis quanto ao uso, guarda e conservação.

Botão **Confirmar recebimento** seguido da validação biométrica. Proibido captura facial silenciosa: deve existir **ato explícito**.

## 11. Evidência da entrega (`delivery_evidence`)

Campos: `delivery_id, employee_id, epi_id, ca_number, lot_number, quantity, delivered_at, manager_id, device_id, verification_method, biometric_verification_id, biometric_score, liveness_result, ip_address, session_id, terms_version, hash, created_at`.

Representação canônica da transação → **SHA-256**. Hash protege integridade; não substitui biometria. Futuro opcional: selo/assinatura ICP-Brasil do pacote probatório.

## 12. Ficha eletrônica de EPI

Dinâmica por colaborador: Data · EPI · CA · Lote · Qtd · Motivo · Validação. Exportação PDF, XLSX, CSV (exigência NR-6 de extração de relatórios).

## 13. Motivos da entrega

Tabela parametrizável: entrega inicial, desgaste, dano, extravio, vencimento, mudança de função, mudança de risco, troca preventiva, devolução, ajuste, outros. Justificativa obrigatória conforme o motivo.

## 14. Estoque

Por lote: Produto → CA → Lote → Validade → Localização → Saldo.

Movimentos: entrada, entrega, devolução, transferência, ajuste, perda, descarte, inventário, reserva. Todo movimento gera `stock_movement`. **Saldo é consequência dos movimentos; nunca editado diretamente.**

## 15. FEFO

First Expire, First Out — sugerir automaticamente o lote de menor validade.

## 16. Estoque mínimo

Por unidade/EPI: mínimo, máximo, atual, consumo médio, lead time. Alertas: baixo, ruptura, excesso, lote vencendo, lote vencido.

## 17. Cadastro de EPI

Código interno, descrição, categoria, marca, modelo, fabricante, CA, tipo de proteção, periodicidade de troca, unidade, tamanho, cor, observações, manual, imagem, status. Variações (P/M/G/GG, 39/40/41/42…).

## 18. Integração CAEPI

Sincronizar com a base oficial do MTE (consulta pública + download). Tabelas: `ca_master`, `ca_manufacturer`, `ca_product`, `ca_history`, `ca_sync`. Usuário digita o CA → retorna fabricante, equipamento, descrição, tipo de proteção, situação, validade, dados oficiais, última sincronização.

## 19. Regra de CA

Guardar separadamente `ca_validity` e `purchase_date`. Na entrada do estoque registrar **"CA válido no momento da compra?"** — diferente de "CA válido hoje?". Uma vez comprado com CA válido, o fornecimento observa armazenamento e validade do produto. Regra **no código** (backend) para evitar bloqueios incorretos.

## 20. Matriz Função × Risco × EPI

Função → Atividade → Risco → Medida de controle → EPI recomendado. Alocar colaborador na função ⇒ EPIs obrigatórios calculados. Seleção registrada (NR-6), podendo integrar/referenciar o PGR.

## 21. Kits de EPI

Ex.: Extrusão, Fundição, Manutenção, Elétrica, Solda. Admissão/mudança de função ⇒ gerar kit obrigatório.

## 22. Periodicidade

Vida útil recomendada, prazo padrão, por atividade, por função. Próxima troca = última entrega + prazo.

## 23. Entrega antecipada

Antes do prazo ⇒ "troca antecipada" com motivo obrigatório (dano, perda, contaminação, mudança de função…).

## 24. Consumo anormal

Dashboard: maior consumo por colaborador/setor, EPIs mais substituídos, motivos, custo por colaborador/setor/função. Alertas.

## 25. QR Code / código de barras

EAN, QR, código interno. Fluxo rápido: escanear → localizar lote → selecionar trabalhador → entregar.

## 26. Etiquetas

Para EPI, lote, localização, prateleira, caixa — com QR, código, CA, lote, validade.

## 27. Almoxarifados

Central, unidades, setores. Transferência sempre com origem, destino, responsável, data, quantidade, lote.

## 28. Inventário

Estados: aberto → em contagem → divergente → aprovado → encerrado. Dupla contagem opcional.

## 29. Devolução

EPI, condição, motivo, data, responsável. Destino: reutilizável, higienização, manutenção, descartado.

## 30. Higienização e manutenção

Ciclo: uso → devolução → higienização → inspeção → liberado. Registrar executor de cada etapa.

## 31. Treinamentos

Treinamento, turma, instrutor, participantes, carga horária, conteúdo, certificado, validade, evidências. Associar a EPI, função, risco, NR. Na entrega: alerta "treinamento obrigatório pendente".

## 32. Orientação do EPI

Manual, vídeo, PDF, orientações, riscos cobertos, limitações, uso, ajuste, higienização, armazenamento (itens NR-6).

## 33. Saúde ocupacional (PreventBase Saúde)

Módulo separado na mesma plataforma: ASO, exames, PCMSO, restrições, aptidão, datas, clínica, médico, CRM, documentos.

## 34. Controle de acesso médico

Líder vê **APTO / INAPTO / RESTRIÇÃO OPERACIONAL**, não resultado clínico/diagnóstico/exames. Segregação **desde a modelagem do banco** (`health.view_summary` × `health.view_medical`).

## 35. Exames

Tipos: admissional, periódico, mudança de risco, retorno, demissional, complementar, toxicológico. Status: a agendar, agendado, realizado, vencendo, vencido.

## 36. PGR e riscos

PGR → Estabelecimento → Setor → Atividade → Perigo → Risco → Avaliação → Controle → EPI. Versionado (v1, v2, v3 com vigência); **nunca sobrescrever**.

## 37. Acidentes

Acidente, incidente, quase acidente: colaborador, data, local, atividade, descrição, lesão, parte do corpo, testemunhas, causa, fotos, documentos, ação corretiva. Associar ao S-2210 quando encontrado.

## 38. eSocial Sync — somente leitura (regra estrutural)

**PreventBase NÃO transmite eventos ao eSocial.** Não existe "Enviar S-2210/S-2220/S-2240". Somente: consultar, importar, interpretar, comparar, sincronizar. Eventos SST: S-2210, S-2220, S-2221, S-2240.

## 39. Entrada A — importação ZIP/XML

Recebe ZIP → descompacta → detecta XML → identifica evento → valida XSD → armazena original → interpreta → atualiza base local. Ideal para histórico.

## 40. Entrada B — Webservice (somente consulta/download)

Certificado da empresa → consultar identificadores → download de evento → XML → parser. Respeitar exigência de certificado cliente e restrições operacionais dos serviços. **Sem métodos de transmissão.**

## 41. Proteção contra envio acidental

Biblioteca `esocial-readonly` (nunca `esocial-client`) expõe apenas: `consultIdentifiers()`, `downloadEvent()`, `importXML()`, `validateXML()`, `parseEvent()`. **Nunca `sendEvent()`.** Allowlist de endpoints (somente consulta/download); teste automatizado que falha se surgir método/endpoint de envio.

## 42. Eventos interpretados

Iniciais: S-2200, S-2206, S-2299, S-2210, S-2220, S-2221, S-2240, S-3000. Vínculo (2200/2206/2299) para reconciliação; SST principais: 2210, 2220, 2221, 2240. S-3000 trata exclusões.

## 43. Versionamento eSocial

`schema_registry` (S-1.2, S-1.3, NTs 2025/2026…). XML → detectar namespace → detectar versão → parser correspondente. Nunca parser de versão única.

## 44. Reconciliação eSocial × PreventBase

Tela de divergências lado a lado. **Não corrigir automaticamente**; marcar DIVERGÊNCIA para análise humana.

## 45. Central documental

Documentos para colaborador, EPI, CA, treinamento, PGR, ASO, acidente, empresa. Arquivo no MinIO/S3; banco: `document_id, filename, mime_type, size, hash_sha256, storage_path, uploaded_by, uploaded_at`.

## 46. Imutabilidade documental

Documento usado como evidência não é sobrescrito: nova versão (`document_v1`, `v2`…) com hash.

## 47. Alertas

Motor independente: ASO vencendo, CA atualizado, lote vencendo, treinamento vencendo, estoque mínimo, colaborador sem EPI obrigatório, troca atrasada, PGR vencendo, exame vencido.

## 48. Dashboard principal

Colaboradores ativos / com pendências, EPIs entregues no mês, EPIs vencendo, estoque crítico, ASOs e treinamentos vencendo, acidentes, pendências SST, divergências eSocial.

## 49. Dashboard de EPI

Consumo e custo mensal, por setor, por funcionário, mais utilizados, motivos de troca, estoque, lotes vencendo.

## 50. PreventScore

Indicador operacional interno (EPIs, treinamentos, ASO, riscos, documentos, pendências). **Não é declaração jurídica de conformidade.**

## 51. Auditoria (`audit_log`)

Usuário, ação, registro, valor anterior, valor novo, data, IP, device, `request_id`. Obrigatória em operações críticas.

## 52. Eventos imutáveis

Entrega de EPI, biometria, baixa de estoque, exame, importação eSocial, acidente: **sem delete físico**; cancelamento via `cancelled_at`, `cancelled_by`, `cancellation_reason`, preservando o original.

## 53. Perfis

Super Admin, Administrador Empresa, Técnico SST, Engenheiro SST, Médico, RH, Líder, Almoxarife, Auditor, Consulta.

## 54. Permissões granulares

Ex.: `epi.view`, `epi.create`, `epi.deliver`, `epi.return`, `inventory.view`, `inventory.adjust`, `employee.view`, `health.view_summary`, `health.view_medical`, `esocial.view`, `esocial.import`, `audit.view`. Nunca depender só de `role = admin`.

## 55. Autenticação

JWT curto, refresh token rotativo, MFA opcional, revogação de sessão, controle por dispositivo. Preparar OIDC (Azure AD/Microsoft Entra, Google Workspace).

## 56. Trusted Device

`device_id`, responsável, modelo, último acesso, status. Pode ser obrigatório para biometria.

## 57. LGPD

Módulo de governança: finalidade, categoria do dado, base legal configurada, fonte, responsável, retenção, acessos. Controles específicos para biometria e saúde (dados sensíveis).

## 58. API

`/api/v1/` + `auth, companies, establishments, departments, jobs, employees, epis, ca, stock, lots, deliveries, biometrics, risks, pgr, trainings, health, exams, aso, accidents, esocial, documents, reports, audit`.

## 59. Entidades principais

`tenants, companies, establishments, departments, jobs, employees, employee_history, users, roles, permissions, user_roles, epi_products, epi_variants, epi_ca, ca_master, ca_history, epi_job_requirements, warehouses, stock_locations, stock_lots, stock_movements, epi_deliveries, epi_delivery_items, delivery_evidence, epi_returns, biometric_profiles, biometric_verifications, risks, risk_agents, job_risks, pgr, pgr_versions, trainings, training_classes, training_participants, health_records, medical_exams, aso, accidents, esocial_events, esocial_event_raw, esocial_sync, esocial_divergences, documents, document_versions, notifications, audit_logs, devices`.

`biometric_profiles` no banco principal guarda só referência/estado; template fica no domínio do `biometric-service` (§8). Dados clínicos em schema/tabelas segregadas (§34).

## 60. Busca global

Nome, CPF, matrícula, CA, EPI, documento, lote, treinamento.

## 61. Interface mobile

Fluxo de entrega **mobile-first**, uso com uma mão: abrir → buscar colaborador → selecionar EPI → escanear → validar rosto → confirmar.

## 62. PWA

Instalável ("Adicionar PreventBase à tela inicial"); sem app nativo inicialmente.

## 63. Offline

V1 offline: consulta em cache, contagem de estoque, rascunho. **Não finalizar entrega/validação facial offline.** Futuro: PreventBase Edge.

## 64. Relatórios

Ficha de EPI por trabalhador, entregas por período/gestor, EPI por setor/função, consumo por colaborador/setor, estoque, validade, CA, inventário, exames, ASO, treinamentos, acidentes, PGR, pendências, auditoria.

## 65. PDF probatório de entrega

Empresa, colaborador, EPI, CA, lote, quantidade, data, responsável, forma de confirmação, identificador da verificação biométrica, hash, QR de verificação. **Sem template ou dado facial.**

## 66. Verificação pública

`/verificar/{public_id}`: documento válido, hash válido, empresa, data, tipo — sem dados sensíveis.

## 67. Notificações

Internas primeiro; depois e-mail, WhatsApp, Teams. Domínio não depende dos canais.

## 68. Webhooks

`employee.created`, `employee.updated`, `epi.delivered`, `epi.returned`, `stock.low`, `aso.expiring`, `training.expiring`, `accident.created`.

## 69. Integração RH

Interface `EmployeeProvider` (ERP, folha, API, CSV, eSocial) sem acoplamento a sistema específico.

## 70. Subsistemas

PreventBase → EPI, Estoque, Saúde, Riscos, Treinamentos, Acidentes, Documentos, eSocial Sync. Podem virar produtos separados mantendo login, cadastro, API e hub.

## 71–77. Fases

| Fase | Escopo |
|------|--------|
| **1 — MVP** | Multiempresa, usuários/permissões, colaboradores, setores/funções, cadastro EPI, CAEPI, lotes, estoque, entrada, entrega, biometria, devolução, ficha EPI, relatórios, auditoria |
| 2 | Riscos, matriz Função × EPI, kits, PGR, treinamentos, vencimentos, dashboard avançado |
| 3 | ASO, exames, PCMSO, saúde ocupacional, controle médico |
| 4 | eSocial XML/ZIP, S-2210, S-2220, S-2221, S-2240, reconciliação |
| 5 | Webservice eSocial somente leitura, sincronização automática, identificadores, download, certificados digitais |
| 6 | Acidentes, planos de ação, inspeções, não conformidades, quase acidentes, indicadores |
| 7 | Analytics, IA, reconhecimento documental, previsão de consumo, anomalias, PreventBase Edge |

Mesmo com escopo faseado, o **modelo de dados da Fase 1 já reserva** as entidades das fases seguintes que afetam chaves e relacionamentos (função, risco, saúde segregada, documentos, eSocial raw) — §0 item 1.

## 78. IA (futuro)

Consumo anormal, previsão de ruptura, função com risco sem EPI, extração de ASO/PGR/laudos/certificados. **Sempre com validação humana** em decisões relevantes.

## 79. Regras obrigatórias de programação

1. Não excluir registros críticos fisicamente.
2. Toda operação relevante tem auditoria.
3. Entregas de EPI são imutáveis.
4. Estoque sempre por movimento.
5. Documentos sempre versionados.
6. Biometria isolada do domínio principal.
7. Dados de saúde segregados.
8. APIs versionadas.
9. eSocial somente leitura.
10. CA guarda histórico.
11. Toda tabela multiempresa possui tenant.
12. Datas armazenadas de forma consistente (UTC / `timestamptz`).
13. Frontend nunca decide regra legal sozinho.
14. Regras de negócio no backend.
15. Nenhuma credencial em código.
16. Secrets via environment/secrets manager.
17. Toda migration versionada.
18. Testes obrigatórios para fluxos críticos.

## 80. Testes críticos

Entrega simultânea, dupla entrega, estoque negativo, lote vencido, CA incorreto, troca antecipada, biometria recusada, biometria repetida, replay de requisição, usuário sem permissão, cancelamento, alteração de ficha, importação XML duplicada, eSocial S-3000, mudança de versão XSD.

## 81. Idempotência

Entrega, estoque e importação eSocial com `idempotency_key`. Duplo clique em CONFIRMAR não gera duas entregas.

## 82. Hash chain de auditoria

Cada evento guarda `previous_hash` e `current_hash`; alteração indevida quebra a cadeia.

## 83. Backup

PostgreSQL diário, arquivos/MinIO, configurações. Backup + retenção + **teste de restore** (backup não testado não é válido).

## 84. Observabilidade

Logs estruturados, `request_id`, healthcheck, métricas, erros, tempo de resposta, filas, armazenamento. Endpoints `/health` e `/ready`.

## 85. Módulos de domínio (backend)

`identity, organization, people, safety, epi, inventory, biometric, risk, training, health, accident, esocial, documents, audit, reporting, notification, integration`.

## 86. Arquitetura

Modular monolith NestJS com módulos bem separados. Separados desde já: `biometric-service`, workers, storage. Microserviços só quando o crescimento justificar.

## 87. Objetivo final

Abrir um funcionário e ver, por exemplo:

```
João da Silva — Operador de Extrusão
✓ ASO válido   ✓ PGR compatível   ✓ Treinamentos válidos
EPIs obrigatórios: 5 · Entregues: 5 · Pendentes: 0
Última entrega: 02/10/2026 · Próxima troca: 02/12/2026
Riscos: Ruído, Calor, Impacto
eSocial: S-2220 localizado · S-2240 localizado
Pendências: nenhuma
```

---

## Histórico

| Data | Mudança |
|------|---------|
| 07/10/2026 | Versão inicial oficial (consolida conversas anteriores) |
| 07/10/2026 | Fase 1 implantada: stack Docker (9 serviços), API/worker/web/biometria, hub Robby (id 31, `preventbase_leitura`), docs por módulo em `docs/SUMMARY.md` |
