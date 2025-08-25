import { userSchema, createUserSchema, updateUserSchema } from '@flakeguard/shared';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

export async function userRoutes(fastify: FastifyInstance) {
  // Get all users
  fastify.get('/', {
    schema: {
      description: 'Get all users',
      tags: ['Users'],
      response: {
        200: z.array(userSchema),
      },
    },
  }, async (request, reply) => {
    const users = await fastify.prisma.user.findMany();
    return reply.send(users);
  });

  // Get user by ID
  fastify.get('/:id', {
    schema: {
      description: 'Get user by ID',
      tags: ['Users'],
      params: z.object({
        id: z.string(),
      }),
      response: {
        200: userSchema,
        404: z.object({
          statusCode: z.number(),
          error: z.string(),
          message: z.string(),
        }),
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    
    const user = await fastify.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'User not found',
      });
    }

    return reply.send(user);
  });

  // Create user
  fastify.post('/', {
    schema: {
      description: 'Create a new user',
      tags: ['Users'],
      body: createUserSchema,
      response: {
        201: userSchema,
      },
    },
  }, async (request, reply) => {
    const data = createUserSchema.parse(request.body);
    
    const user = await fastify.prisma.user.create({
      data,
    });

    return reply.status(201).send(user);
  });

  // Update user
  fastify.patch('/:id', {
    schema: {
      description: 'Update user',
      tags: ['Users'],
      params: z.object({
        id: z.string(),
      }),
      body: updateUserSchema,
      response: {
        200: userSchema,
        404: z.object({
          statusCode: z.number(),
          error: z.string(),
          message: z.string(),
        }),
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = updateUserSchema.parse(request.body);
    
    try {
      const user = await fastify.prisma.user.update({
        where: { id },
        data,
      });
      
      return reply.send(user);
    } catch (error) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'User not found',
      });
    }
  });

  // Delete user
  fastify.delete('/:id', {
    schema: {
      description: 'Delete user',
      tags: ['Users'],
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
      await fastify.prisma.user.delete({
        where: { id },
      });
      
      return reply.status(204).send();
    } catch (error) {
      return reply.status(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'User not found',
      });
    }
  });
}