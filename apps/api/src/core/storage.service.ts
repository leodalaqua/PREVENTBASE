import { Injectable, type OnModuleInit } from "@nestjs/common";
import { Client } from "minio";
import type { Readable } from "node:stream";
import { config } from "../config.js";
import { log } from "./http.js";

@Injectable()
export class StorageService implements OnModuleInit {
  readonly client = new Client({
    endPoint: config.minio.endPoint,
    port: config.minio.port,
    useSSL: config.minio.useSSL,
    accessKey: config.minio.accessKey,
    secretKey: config.minio.secretKey,
  });
  readonly bucket = config.minio.bucket;

  async onModuleInit(): Promise<void> {
    try {
      if (!(await this.client.bucketExists(this.bucket))) await this.client.makeBucket(this.bucket);
    } catch (err) {
      log("warn", "minio indisponível no boot", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.putObject(this.bucket, key, data, data.length, { "Content-Type": contentType });
  }

  async get(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key);
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.bucketExists(this.bucket);
      return true;
    } catch {
      return false;
    }
  }
}
