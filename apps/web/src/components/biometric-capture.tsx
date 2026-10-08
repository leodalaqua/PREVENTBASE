"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Button, cx, ErrorBox } from "./ui";

interface Challenge {
  challengeId: string;
  action: "TURN_LEFT" | "TURN_RIGHT";
  instruction: string;
  frameCount: number;
  expiresAt: string;
}

export interface VerifyResult {
  verificationId: string;
  verified: boolean;
  score: number;
  liveness: boolean;
  reason: string | null;
}

type Phase = "idle" | "camera" | "ready" | "countdown" | "frontal" | "turn" | "sending" | "done";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Captura com prova de vida por desafio (§8). Quadros são enviados à API apenas para o
 * biometric-service — nada é armazenado no navegador nem no banco principal.
 */
export function BiometricCapture({
  employeeId,
  purpose,
  onVerified,
  onEnrolled,
}: {
  employeeId: string;
  purpose: "ENROLL" | "DELIVERY";
  onVerified?: (r: VerifyResult) => void;
  onEnrolled?: (r: { id: string; quality: number }) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(3);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const startCamera = useCallback(
    async (mode: "environment" | "user") => {
      setError(null);
      stopCamera();
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play();
        }
        setPhase("ready");
      } catch {
        setError(new Error("Não foi possível acessar a câmera. Verifique a permissão do navegador (requer HTTPS)."));
        setPhase("idle");
      }
    },
    [stopCamera],
  );

  useEffect(() => stopCamera, [stopCamera]);

  function grab(): string {
    const v = video.current!;
    const scale = Math.min(1, 640 / v.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  async function run() {
    setError(null);
    setResult(null);
    try {
      const ch = await api.post<Challenge>("/biometrics/challenge", { employeeId, purpose });
      setChallenge(ch);
      setPhase("countdown");
      for (let i = 3; i > 0; i--) {
        setCount(i);
        await sleep(700);
      }
      setPhase("frontal");
      const frames: string[] = [];
      for (let i = 0; i < 2; i++) {
        await sleep(250);
        frames.push(grab());
      }
      setPhase("turn");
      await sleep(350);
      while (frames.length < ch.frameCount) {
        frames.push(grab());
        await sleep(300);
      }
      setPhase("sending");
      if (purpose === "ENROLL") {
        const r = await api.post<{ id: string; quality: number }>("/biometrics/enroll", { employeeId, challengeId: ch.challengeId, frames });
        setPhase("done");
        stopCamera();
        onEnrolled?.(r);
      } else {
        const r = await api.post<VerifyResult>("/biometrics/verify", { employeeId, challengeId: ch.challengeId, frames });
        setResult(r);
        if (r.verified && r.liveness) {
          setPhase("done");
          stopCamera();
          onVerified?.(r);
        } else setPhase("ready");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e : new Error("Falha na captura"));
      setPhase(stream.current ? "ready" : "idle");
    }
  }

  const turnLabel = challenge?.action === "TURN_LEFT" ? "◀ VIRE O ROSTO PARA A SUA ESQUERDA" : "VIRE O ROSTO PARA A SUA DIREITA ▶";

  return (
    <div className="space-y-3">
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-slate-900 sm:aspect-video">
        <video ref={video} playsInline muted className={cx("h-full w-full object-cover", facing === "user" && "-scale-x-100")} />
        {phase === "idle" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-white">
            <p className="text-sm">Posicione o colaborador de frente, com boa iluminação e sem boné/óculos escuros.</p>
            <Button onClick={() => void startCamera(facing)}>Abrir câmera</Button>
          </div>
        )}
        {phase !== "idle" && phase !== "done" && <div className="pointer-events-none absolute inset-[12%] rounded-[45%] border-4 border-white/60" />}
        {phase === "countdown" && <div className="absolute inset-0 flex items-center justify-center text-7xl font-bold text-white drop-shadow">{count}</div>}
        {phase === "frontal" && <div className="absolute inset-x-0 bottom-4 text-center text-lg font-semibold text-white drop-shadow">OLHE PARA A CÂMERA</div>}
        {phase === "turn" && <div className="absolute inset-x-0 bottom-4 animate-pulse text-center text-lg font-bold text-amber-300 drop-shadow">{turnLabel}</div>}
        {phase === "sending" && <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">Validando…</div>}
        {phase === "done" && <div className="absolute inset-0 flex items-center justify-center bg-emerald-700/80 text-xl font-semibold text-white">✔ {purpose === "ENROLL" ? "Biometria cadastrada" : "Identidade confirmada"}</div>}
      </div>

      {challenge && phase === "ready" && <p className="text-sm text-slate-600">Desafio: {challenge.instruction}</p>}
      {result && !result.verified && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Não confirmado: {result.reason ?? "rosto não corresponde"}{result.liveness ? ` (similaridade ${result.score.toFixed(2)})` : ""}. Tente novamente.
        </div>
      )}
      <ErrorBox error={error} />

      {(phase === "ready" || phase === "camera") && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void run()} className="flex-1">
            {purpose === "ENROLL" ? "Capturar e cadastrar" : "Validar identidade"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const next = facing === "environment" ? "user" : "environment";
              setFacing(next);
              void startCamera(next);
            }}
          >
            ⟲ Câmera
          </Button>
        </div>
      )}
    </div>
  );
}
