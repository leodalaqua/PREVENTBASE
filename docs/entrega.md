# Entrega, evidência e devolução

## Responsabilidade

Entrega de EPI com confirmação explícita + biometria facial 1:1 com prova de vida (§9-§13), evidência legal, ficha eletrônica, devolução (§29) e verificação pública por QR (§65-§66).

## Fluxo

1. `POST /deliveries/prepare` — valida colaborador ativo, biometria cadastrada, termo ativo, lote (informado ou FEFO), saldo, validade, CA (compra/hoje), periodicidade. Troca antecipada exige motivo DAMAGE/LOSS/etc. + justificativa.
2. Web captura a biometria (`purpose: DELIVERY`) → `biometricVerificationId`.
3. `POST /deliveries` com `Idempotency-Key` obrigatório, `confirmed: true`, `termsVersion` e a verificação. Só em dispositivo `TRUSTED`.

A verificação precisa ser do mesmo colaborador e operador, aprovada com liveness, recente (`biometricMaxAgeSeconds`) e é consumida (uso único → 409 `BIOMETRIC_REPLAY`). Replay da mesma chave devolve a mesma entrega (`replayed: true`).

## Evidência

JSON canônico → SHA-256 (`DeliveryEvidence.hash`), PDF com QR para `PUBLIC_BASE_URL/verificar/<publicId>` (`GET /deliveries/:id/pdf`). `GET /public/verify/:publicId` (sem login) recalcula o hash, mascara o nome e mostra status. Entrega é imutável no banco; só `POST /deliveries/:id/cancel` (motivo) muda o status.

## Devolução

`POST /returns`: REUSABLE + GOOD volta direto ao estoque; demais seguem etapas (`/returns/:id/steps`: higienização, manutenção, inspeção → RELEASED gera movimento RETURN, ou DISCARDED).

## Arquivos

`apps/api/src/modules/delivery/` · web `(app)/entregas/` (assistente `nova/`), `(app)/devolucoes/`, `verificar/[publicId]/`.
