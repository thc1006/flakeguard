import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { taskSchema, createTaskSchema, updateTaskSchema, TaskStatus, Priority } from '@flakeguard/shared';

export async function taskRoutes(fastify: FastifyInstance) {
  // Get all tasks
  fastify.get('/', {
    schema: {
      description: 'Get all tasks',
      tags: ['Tasks'],
      querystring: z.object({
        userId: z.string().optional(),
        status: z.nativeEnum(TaskStatus).optional(),
        priority: z.nativeEnum(Priority).optional(),
        limit: z.string().transform(Number).default('50'),
        offset: z.string().transform(Number).default('0'),
      }),
      response: {
        200: z.array(taskSchema),
      },
    },
  }, async (request, reply) => {
    const { userId, status, priority, limit, offset } = request.query as any;
    
    const tasks = await fastify.prisma.task.findMany({
      where: {
        ...(userId && { userId }),
        ...(status && { status }),
        ...(priority && { priority }),
      },
      take: limit,
      skip: offset,
      include: {
        user: true,
      },
    });

    return reply.send(tasks);
  });

  // Get task by ID
  fastify.get('/:id', {
    schema: {
      description: 'Get task by ID',
      tags: ['Tasks'],
      params: z.object({
        id: z.string(),
      }),
      response: {
        200: taskSchema,
        404: z.object({
          statusCode: z.number(),
          error: z.string(),
          message: z.string(),
        }),
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    
    const task = await fastify.prisma.task.findUnique({
      where: { id },
      include: {
        user: true,
      },
    });

    if (!task) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Task not found',
      });
    }

    return reply.send(task);
  });

  // Create task
  fastify.post('/', {
    schema: {
      description: 'Create a new task',
      tags: ['Tasks'],
      body: createTaskSchema,
      response: {
        201: taskSchema,
      },
    },
  }, async (request, reply) => {
    const data = createTaskSchema.parse(request.body);
    
    const task = await fastify.prisma.task.create({
      data,
      include: {
        user: true,
      },
    });

    return reply.status(201).send(task);
  });

  // Update task
  fastify.patch('/:id', {
    schema: {
      description: 'Update task',
      tags: ['Tasks'],
      params: z.object({
        id: z.string(),
      }),
      body: updateTaskSchema,
      response: {
        200: taskSchema,
        404: z.object({
          statusCode: z.number(),
          error: z.string(),
          message: z.string(),
        }),
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updateTaskSchema.parse(request.body);
    
    try {
      const task = await fastify.prisma.task.update({
        where: { id },
        data,
        include: {
          user: true,
        },
      });
      
      return reply.send(task);
    } catch (error) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Task not found',
      });
    }
  });

  // Delete task
  fastify.delete('/:id', {
    schema: {
      description: 'Delete task',
      tags: ['Tasks'],
      params: z.object({
        id: z.string(),
      }),
      response: {
        204: z.null(),
        404: z.object({
          statusCode: z.number(),
          error: z.string(),
          message: z.string(),
        }),
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    
    try {
      await fastify.prisma.task.delete({
        where: { id },
      });
      
      return reply.status(204).send();
    } catch (error) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Task not found',
      });
    }
  });
}