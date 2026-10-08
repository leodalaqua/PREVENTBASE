function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

export const config = {
  host: process.env.APP_HOST ?? "0.0.0.0",
  port: Number(process.env.APP_PORT ?? 3101),
  jwtSecret: required("JWT_SECRET"),
  accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS ?? 900),
  refreshTtlDays: Number(process.env.REFRESH_TTL_DAYS ?? 14),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  minio: {
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: Number(process.env.MINIO_PORT ?? 3112),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ACCESS_KEY ?? process.env.MINIO_ROOT_USER ?? "",
    secretKey: process.env.MINIO_SECRET_KEY ?? process.env.MINIO_ROOT_PASSWORD ?? "",
    bucket: process.env.MINIO_BUCKET ?? "preventbase-documents",
  },
  biometric: {
    url: (process.env.BIOMETRIC_SERVICE_URL ?? "http://localhost:8000").replace(/\/$/, ""),
    token: required("BIOMETRIC_SERVICE_TOKEN"),
  },
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "http://localhost:3100").replace(/\/$/, ""),
  caepiSourceUrl: process.env.CAEPI_SOURCE_URL ?? "",
};
