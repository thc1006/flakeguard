import { PrismaClient } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { logger } from '../utils/logger.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

async function prismaPlugin(fastify: FastifyInstance) {
  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' 
      ? ['query', 'info', 'warn', 'error']
      : ['error'],
  });

  await prisma.$connect();
  
  logger.info('Prisma connected to database');

  fastify.decorate('prisma', prisma);

  fastify.addHook('onClose', async (server) => {
    await server.prisma.$disconnect();
    logger.info('Prisma disconnected from database');
  });
}

export default fp(prismaPlugin, {
  name: 'prisma',
});