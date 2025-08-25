import { Job, Processor } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { EmailJobData } from '@flakeguard/shared';

export function emailProcessor(prisma: PrismaClient): Processor {
  return async (job: Job<EmailJobData>) => {
    const { to, subject, body, userId } = job.data;
    
    logger.info(
      { jobId: job.id, to, subject },
      'Processing email job'
    );

    try {
      // Simulate email sending
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      // In a real application, you would integrate with an email service here
      // e.g., SendGrid, AWS SES, Postmark, etc.
      
      logger.info(
        { jobId: job.id, to },
        'Email sent successfully'
      );

      // Log the email activity in the database if needed
      if (userId) {
        // You could create an EmailLog model in Prisma
        // await prisma.emailLog.create({
        //   data: { userId, to, subject, sentAt: new Date() }
        // });
      }

      return {
        success: true,
        sentAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(
        { jobId: job.id, error: (error as Error).message },
        'Failed to send email'
      );
      throw error;
    }
  };
}