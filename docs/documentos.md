# Documentos

## Responsabilidade

Anexos por entidade (colaborador, EPI, CA, entrega, empresa e entidades SST futuras) com versionamento (§45-§46).

## Regras

- Upload multipart (`file`, `entityType`, `entityId`, `title`, `category`, `isEvidence`) → MinIO bucket `MINIO_BUCKET`; versão nova em `POST /documents/:id/versions`; download por versão.
- Cada versão guarda SHA-256, tamanho, tipo e autor; registro auditado. Limite de corpo no nginx: 60 MB.

## Arquivos

`apps/api/src/modules/documents/` · `apps/api/src/core/storage.service.ts` · web `components/documents-panel.tsx`.
