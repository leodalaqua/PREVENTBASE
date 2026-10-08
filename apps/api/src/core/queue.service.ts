import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../config.js";

export const QUEUE_NAME = "preventbase";

@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  readonly queue = new Queue(QUEUE_NAME, { connection: this.connection });

  async enqueue(name: string, data: Record<string, unknown>, jobId?: string): Promise<string | undefined> {
    const job = await this.queue.add(name, data, { jobId, removeOnComplete: 200, removeOnFail: 500, attempts: 2, backoff: { type: "exponential", delay: 30_000 } });
    return job.id;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.connection.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.connection.disconnect();
  }
}
