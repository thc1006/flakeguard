import { z } from 'zod';

// Email job schemas
export const emailJobDataSchema = z.object({
  to: z.string().email(),
  subject: z.string(),
  body: z.string(),
  userId: z.string().optional(),
});

export type EmailJobData = z.infer<typeof emailJobDataSchema>;

// Task job schemas
export const taskJobDataSchema = z.object({
  taskId: z.string(),
  action: z.enum(['process', 'retry', 'cancel']),
});

export type TaskJobData = z.infer<typeof taskJobDataSchema>;

// Report job schemas
export const reportJobDataSchema = z.object({
  userId: z.string(),
  reportType: z.enum(['tasks', 'summary']),
  startDate: z.string(),
  endDate: z.string(),
});

export type ReportJobData = z.infer<typeof reportJobDataSchema>;