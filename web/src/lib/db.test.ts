import { afterEach, describe, expect, it, vi } from 'vitest';

const { createClient, createAdapter, query, disconnect } = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdapter: vi.fn(),
  query: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('@prisma/adapter-pg', () => ({
  PrismaPg: class {
    constructor(options: unknown) {
      createAdapter(options);
    }
  },
}));
vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    familyMember = { findMany: query };
    constructor() {
      createClient();
    }
    $disconnect() {
      disconnect(this);
    }
  },
}));

function clearClient() {
  Reflect.deleteProperty(globalThis, 'prisma');
}

afterEach(() => {
  clearClient();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('Prisma client lifetime', () => {
  it.each(['production', 'development'])(
    '%s reuses one pool across repeated accesses',
    async (mode) => {
      clearClient();
      vi.stubEnv('NODE_ENV', mode);
      vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost/test');
      const { prisma } = await import('./db');
      expect(createClient).not.toHaveBeenCalled();
      for (let i = 0; i < 100; i++) {
        await prisma.familyMember.findMany();
      }
      const close = prisma.$disconnect;
      await close();
      expect(createClient).toHaveBeenCalledTimes(1);
      expect(createAdapter).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledTimes(100);
      expect(disconnect.mock.calls[0]?.[0]).toHaveProperty('familyMember');
      vi.resetModules();
      const reloaded = await import('./db');
      expect(reloaded.prisma.familyMember).toBe(prisma.familyMember);
      expect(createClient).toHaveBeenCalledTimes(1);
    },
  );

  it('requires database configuration only at first use', async () => {
    clearClient();
    vi.stubEnv('DATABASE_URL', '');
    const { prisma } = await import('./db');
    expect(createClient).not.toHaveBeenCalled();
    expect(() => prisma.familyMember).toThrow('DATABASE_URL');
  });
});
