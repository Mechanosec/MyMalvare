import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // A subclass with no explicit constructor doesn't reliably inherit a
  // generated PrismaClient's constructor overload, so this forwards
  // PrismaClient's own options type explicitly (e.g. a datasources
  // override, used by tests to point at a per-test SQLite file).
  constructor(options?: Prisma.PrismaClientOptions) {
    super(options);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
