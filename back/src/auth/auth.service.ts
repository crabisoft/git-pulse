import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthState, Page, UserPublic, UserRole } from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CodedException } from '../common/coded-exception';
import { toPage, type PageWindow } from '../common/pagination';
import { hashPassword, verifyPassword } from './password';
import { SESSION_TTL_MS } from './session-cookie';
import type { LoginDto } from './dto/login.dto';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';

/**
 * Verified against on a sign-in attempt for an unknown address, so a wrong
 * email and a wrong password cost the same time. It must be well-formed —
 * 16-byte salt, 64-byte key, both hex — or `verifyPassword` rejects it before
 * doing the work that makes the timings match.
 */
const DECOY_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  // ─── Session ───────────────────────────────────────────────────────

  /** Who the caller is, and what this install lets them do without an account. */
  async state(user: UserPublic | null): Promise<AuthState> {
    const [{ publicDashboard }, users] = await Promise.all([
      this.settings.get(),
      this.prisma.user.count(),
    ]);
    return { user, publicDashboard, setupRequired: users === 0 };
  }

  /**
   * The account behind a session cookie, or null. An expired row is dropped on
   * the way out rather than left for the sweep: it will never be valid again.
   */
  async resolve(token: string | null): Promise<UserPublic | null> {
    if (!token) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session) return null;
    if (session.expiresAt <= new Date()) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    return toPublic(session.user);
  }

  /**
   * Verifies the credentials and opens a session. Every failure answers the
   * same code: which half was wrong is precisely what an attacker is asking.
   */
  async login(dto: LoginDto): Promise<{ user: UserPublic; token: string }> {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(dto.email) } });
    const ok = await verifyPassword(dto.password, user?.passwordHash ?? DECOY_HASH);
    if (!user || !ok) {
      throw new CodedException('errors.auth.invalidCredentials', HttpStatus.UNAUTHORIZED);
    }

    // Cheap, and it keeps the table from growing with sessions nobody can use.
    await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return { user: toPublic(user), token: await this.openSession(user.id) };
  }

  async logout(token: string | null): Promise<void> {
    if (!token) return;
    await this.prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  /**
   * Creates the very first account, as an admin, and signs it in. Open without
   * credentials because there are none to present yet, and closed for good as
   * soon as it succeeds — an install with an admin has no bootstrap left.
   */
  async setup(dto: CreateUserDto): Promise<{ user: UserPublic; token: string }> {
    if ((await this.prisma.user.count()) > 0) {
      throw new CodedException('errors.auth.setupDone', HttpStatus.CONFLICT);
    }
    const user = await this.createUser({ ...dto, role: 'admin' });
    return { user, token: await this.openSession(user.id) };
  }

  private async openSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return token;
  }

  // ─── Accounts ──────────────────────────────────────────────────────

  async findAll(window: PageWindow): Promise<Page<UserPublic>> {
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        skip: window.offset,
        take: window.limit,
      }),
      this.prisma.user.count(),
    ]);
    return toPage(users.map(toPublic), total, window);
  }

  async createUser(dto: CreateUserDto): Promise<UserPublic> {
    const email = normalizeEmail(dto.email);
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new CodedException('errors.auth.emailTaken', HttpStatus.CONFLICT, { email });
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        passwordHash: await hashPassword(dto.password),
        role: dto.role ?? 'user',
      },
    });
    return toPublic(user);
  }

  /**
   * Partial update. A new password or a lost admin role invalidates the
   * account's other sessions at once — the point of keeping sessions in the
   * database is that a change of access does not wait for a token to expire.
   * `keepToken` spares the caller's own session, so an admin editing their own
   * account is not signed out by it.
   */
  async updateUser(id: string, dto: UpdateUserDto, keepToken: string | null): Promise<UserPublic> {
    const current = await this.byId(id);
    if (dto.role !== undefined && dto.role !== 'admin') await this.assertNotLastAdmin(current);

    const email = dto.email !== undefined ? normalizeEmail(dto.email) : undefined;
    if (email !== undefined && email !== current.email) {
      if (await this.prisma.user.findUnique({ where: { email } })) {
        throw new CodedException('errors.auth.emailTaken', HttpStatus.CONFLICT, { email });
      }
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        email,
        name: dto.name,
        role: dto.role,
        passwordHash: dto.password === undefined ? undefined : await hashPassword(dto.password),
      },
    });

    if (dto.password !== undefined || (dto.role !== undefined && dto.role !== current.role)) {
      await this.prisma.session.deleteMany({
        where: {
          userId: id,
          tokenHash: keepToken ? { not: hashToken(keepToken) } : undefined,
        },
      });
    }
    return toPublic(user);
  }

  /** Sessions go with the row: the cascade in the schema is the whole revocation. */
  async removeUser(id: string): Promise<void> {
    await this.assertNotLastAdmin(await this.byId(id));
    await this.prisma.user.delete({ where: { id } });
  }

  private async byId(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new CodedException('errors.auth.userNotFound', HttpStatus.NOT_FOUND);
    return user;
  }

  /**
   * An install with no admin left can no longer be configured, and no route can
   * bring one back — the bootstrap only opens on an empty table.
   */
  private async assertNotLastAdmin(user: { id: string; role: UserRole }): Promise<void> {
    if (user.role !== 'admin') return;
    if ((await this.prisma.user.count({ where: { role: 'admin' } })) > 1) return;
    throw new CodedException('errors.auth.lastAdmin', HttpStatus.CONFLICT);
  }
}

/** Sessions are looked up by digest, never by the token the browser holds. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Addresses are identity here, so case and stray spaces must not create twins. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toPublic(u: {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}): UserPublic {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}
