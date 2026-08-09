import { PrismaClient } from '@prisma/client';
import { prismaAdapter } from '../prisma/adapter';
import { hashPassword } from '../auth/password';
import { PASSWORD_MIN_LENGTH } from '@repo/shared';

/**
 * Escape hatch for the one state the UI cannot repair: nobody can sign in as an
 * admin any more. Sets an account's password, and creates the account as an
 * admin if the address is unknown — so a lost or deleted last admin is one
 * command away rather than a session with `psql`.
 *
 * Run where DATABASE_URL is set, which means inside the API container:
 *   make set-password email=you@example.com password=…
 *
 * It reuses the application's own hashing on purpose: a second implementation
 * of it is a second thing to get wrong, and this one runs the day the first
 * one is unavailable.
 */
async function main(): Promise<void> {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    fail('Usage: set-password <email> <password>');
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    fail(`The password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }

  const prisma = new PrismaClient({ adapter: prismaAdapter() });
  try {
    const normalized = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);
    const existing = await prisma.user.findUnique({ where: { email: normalized } });

    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { passwordHash } });
      // Every session of that account goes: a password reset that leaves the
      // old ones open has reset nothing.
      const { count } = await prisma.session.deleteMany({ where: { userId: existing.id } });
      console.log(`Password updated for ${normalized} (${existing.role}).`);
      if (count > 0) console.log(`${count} open session(s) closed.`);
      return;
    }

    await prisma.user.create({
      data: { email: normalized, name: normalized, passwordHash, role: 'admin' },
    });
    console.log(`Admin account created for ${normalized}.`);
  } finally {
    await prisma.$disconnect();
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main().catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));
