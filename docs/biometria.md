# Biometria facial

## Responsabilidade

Cadastro e verificação facial 1:1 com prova de vida por desafio (§8). Serviço isolado: o template **nunca** chega à API principal nem ao Postgres.

## Desenho

- `apps/biometric-service` (FastAPI, só rede interna `biometric:8000`, header `x-service-token`). Docs da FastAPI desligadas; `/health` público.
- Detecção YuNet + embedding SFace (OpenCV), similaridade cosseno, limiar `BIOMETRIC_MATCH_THRESHOLD` (0.363).
- Prova de vida: desafio de uso único (`TURN_LEFT`/`TURN_RIGHT`, TTL 120 s). Exige 1 rosto dominante, nitidez/tamanho mínimos, quadro frontal + quadro virado no sentido pedido (yaw pelo nariz × olhos), movimento real e mesma pessoa nos quadros. Foto plana girada não muda o yaw → reprovada.
- Template = média dos 3 melhores embeddings frontais, cifrado AES-256-GCM (`BIOMETRIC_TEMPLATE_KEY`, AAD tenant+colaborador) em SQLite no volume `preventbase_biometric_data`. Recadastro substitui e apaga o anterior; revogação apaga o template.
- API (`/biometrics/challenge|enroll|verify`, `DELETE /biometrics/profiles/:id`) só guarda metadados: `BiometricProfile` e `BiometricVerification` (score, liveness, desafio, operador, dispositivo).
- Web (`components/biometric-capture.tsx`): câmera traseira por padrão, contagem, 2 quadros frontais + quadros virados (JPEG ≤ 640 px). Câmera exige HTTPS → usar `https://servidor.taild57d57.ts.net:13100`.

## Validação

`tests/smoke.py` (imagens de exemplo do OpenCV): mesma pessoa 1.0, pessoas diferentes ~0.13, foto estática reprovada. Validação com pessoa real em aparelho: pendente de teste de campo.
