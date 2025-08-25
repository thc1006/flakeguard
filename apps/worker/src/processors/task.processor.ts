import { TaskJobData, TaskStatus } from '@flakeguard/shared';
import { PrismaClient } from '@prisma/client';
import { Job, Processor } from 'bullmq';

import { logger } from '../utils/logger.js';


export function taskProcessor(prisma: PrismaClient): Processor {
  return async (job: Job<TaskJobData>) => {
    const { taskId, action } = job.data;
    
    logger.info(
      { jobId: job.id, taskId, action },
      'Processing task job'
    );

    try {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
      });

      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      switch (action) {
        case 'process':
          // Update task status to in progress
          await prisma.task.update({
            where: { id: taskId },
            data: { status: TaskStatus.IN_PROGRESS },
          });

          // Simulate task processing
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Update task status to completed
          await prisma.task.update({
            where: { id: taskId },
            data: { status: TaskStatus.COMPLETED },
          });
          break;

        case 'retry':
          // Reset task status to pending for retry
          await prisma.task.update({
            where: { id: taskId },
            data: { status: TaskStatus.PENDING },
          });
          break;

        case 'cancel':
          // Update task status to failed
          await prisma.task.update({
            where: { id: taskId },
            data: { status: TaskStatus.FAILED },
          });
          break;

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      logger.info(
        { jobId: job.id, taskId, action },
        'Task job completed successfully'
      );

      return {
        success: true,
        taskId,
        action,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(
        { jobId: job.id, taskId, error: (error as Error).message },
        'Failed to process task'
      );
      
      // Update task status to failed on error
      await prisma.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.FAILED },
      }).catch(() => {});
      
      throw error;
    }
  };
}