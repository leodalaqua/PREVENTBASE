import type { PasskeyApi, PasskeyItem } from "@/components/passkey/passkey-ui";
import { api, setTokens } from "./api";

/** Biometria (passkey) — C:\ROBBY\docs\decisions\2026-10-09-login-passkey.md */
export const passkeyApi: PasskeyApi = {
  prefix: "preventbase",
  loginOptions: () => api.post("/auth/passkey/login/options"),
  loginVerify: async (response) => {
    const tokens = await api.post<{ accessToken: string; refreshToken: string }>("/auth/passkey/login/verify", { response });
    setTokens(tokens);
    return tokens;
  },
  registerOptions: () => api.post("/auth/passkey/register/options"),
  registerVerify: (response, deviceName) => api.post("/auth/passkey/register/verify", { response, deviceName }),
  list: async () => (await api.get<{ items: PasskeyItem[] }>("/auth/passkey")).items ?? [],
  remove: (id) => api.del(`/auth/passkey/${encodeURIComponent(id)}`),
};
