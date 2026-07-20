import { Injectable } from "@nestjs/common";
import { JobExecutionState } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { classifyOperationalError } from "./operational-error";

export interface JobExecutionContext {
  queueName: string;
  jobType: string;
  jobId: string;
  attemptNumber: number;
  workerIdentity: string;
  outboxEventId?: string;
  aggregateType?: string;
  aggregateId?: string;
}

export interface JobExecutionResult<T> {
  value: T;
  providerRef?: string;
}

@Injectable()
export class JobExecutionService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    context: JobExecutionContext,
    handler: () => Promise<JobExecutionResult<T>>
  ): Promise<T> {
    const execution = await this.prisma.jobExecution.upsert({
      where: {
        queueName_jobId_attemptNumber: {
          queueName: context.queueName,
          jobId: context.jobId,
          attemptNumber: context.attemptNumber
        }
      },
      create: {
        queueName: context.queueName,
        jobType: context.jobType,
        jobId: context.jobId,
        attemptNumber: context.attemptNumber,
        workerIdentity: context.workerIdentity,
        outboxEventId: context.outboxEventId,
        aggregateType: context.aggregateType,
        aggregateId: context.aggregateId
      },
      update: {
        state: JobExecutionState.running,
        workerIdentity: context.workerIdentity,
        startedAt: new Date(),
        completedAt: null,
        retryable: null,
        errorCategory: null,
        errorMessage: null
      }
    });

    try {
      const result = await handler();
      await this.prisma.jobExecution.update({
        where: { id: execution.id },
        data: {
          state: JobExecutionState.succeeded,
          completedAt: new Date(),
          retryable: false,
          providerRef: result.providerRef?.slice(0, 255) ?? null
        }
      });
      return result.value;
    } catch (error) {
      const classified = classifyOperationalError(error);
      await this.prisma.jobExecution.update({
        where: { id: execution.id },
        data: {
          state: JobExecutionState.failed,
          completedAt: new Date(),
          retryable: classified.retryable,
          errorCategory: classified.category,
          errorMessage: classified.message
        }
      });
      throw error;
    }
  }

  async recoverStale(staleBefore: Date) {
    return this.prisma.jobExecution.updateMany({
      where: {
        state: JobExecutionState.running,
        startedAt: { lt: staleBefore }
      },
      data: {
        state: JobExecutionState.failed,
        completedAt: new Date(),
        retryable: true,
        errorCategory: "worker_heartbeat_stale",
        errorMessage: "The worker stopped before recording a terminal outcome."
      }
    });
  }
}
