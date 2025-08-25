import { Job, Processor } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { ReportJobData } from '@flakeguard/shared';

export function reportProcessor(prisma: PrismaClient): Processor {
  return async (job: Job<ReportJobData>) => {
    const { userId, reportType, startDate, endDate } = job.data;
    
    logger.info(
      { jobId: job.id, userId, reportType },
      'Processing report job'
    );

    try {
      let reportData: any;

      switch (reportType) {
        case 'tasks':
          reportData = await prisma.task.findMany({
            where: {
              userId,
              createdAt: {
                gte: new Date(startDate),
                lte: new Date(endDate),
              },
            },
            include: {
              user: true,
            },
          });
          break;

        case 'summary':
          const tasks = await prisma.task.groupBy({
            by: ['status'],
            where: {
              userId,
              createdAt: {
                gte: new Date(startDate),
                lte: new Date(endDate),
              },
            },
            _count: {
              status: true,
            },
          });

          reportData = {
            userId,
            period: { startDate, endDate },
            summary: tasks.map(t => ({
              status: t.status,
              count: t._count.status,
            })),
          };
          break;

        default:
          throw new Error(`Unknown report type: ${reportType}`);
      }

      logger.info(
        { jobId: job.id, userId, reportType },
        'Report generated successfully'
      );

      // In a real application, you might:
      // 1. Generate a PDF or Excel file
      // 2. Upload to S3 or similar storage
      // 3. Send email with the report

      return {
        success: true,
        reportType,
        generatedAt: new Date().toISOString(),
        data: reportData,
      };
    } catch (error) {
      logger.error(
        { jobId: job.id, userId, error: (error as Error).message },
        'Failed to generate report'
      );
      throw error;
    }
  };
}