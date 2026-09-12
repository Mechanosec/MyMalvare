import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // A subclass with no explicit constructor doesn't reliably inherit a
  // generated PrismaClient's constructor overload, so this forwards
  // PrismaClient's own options type explicitly (e.g. a datasources
  // override, used by tests to point at a per-test SQLite file).
  // @Optional() is required here: without it, Nest's DI tries to resolve
  // a provider for this parameter (its reflected design type erases to
  // Object since Prisma.PrismaClientOptions is an interface) and throws
  // "can't resolve dependencies" at boot - Optional makes Nest inject
  // undefined instead when nothing provides this token, which is exactly
  // what the real app needs (no override, plain PrismaClient defaults).
  constructor(@Optional() options?: Prisma.PrismaClientOptions) {
    super(options);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
