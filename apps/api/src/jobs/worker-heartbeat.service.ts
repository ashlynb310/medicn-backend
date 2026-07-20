import { Injectable } from "@nestjs/common";
import type { WorkerProcessType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class WorkerHeartbeatService {
  constructor(private readonly prisma: PrismaService) {}

  beat(
    processType: WorkerProcessType,
    instanceId: string,
    processStartedAt: Date,
    version: string
  ) {
    const lastHeartbeatAt = new Date();
    return this.prisma.workerHeartbeat.upsert({
      where: { processType_instanceId: { processType, instanceId } },
      create: {
        processType,
        instanceId,
        processStartedAt,
        lastHeartbeatAt,
        version
      },
      update: { lastHeartbeatAt, version }
    });
  }
}
