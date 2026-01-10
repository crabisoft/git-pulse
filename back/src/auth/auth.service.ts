import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  DISPLAY_MODES,
  OVERVIEW_DIRECTIONS,
  type AuthState,
  type Page,
  type PasswordResetIssued,
  type PasswordResetTarget,
  type UserPublic,
  type UserRole,
} from '@repo/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CodedException } from '../common/coded-exception';
import { toPage, type PageWindow } from '../common/pagination';
import { hashPassword, verifyPassword } from './password';
import { SESSION_TTL_MS } from './session-cookie';
import { LoginThrottle } from './login-throttle';
import type { LoginDto } from './dto/login.dto';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { UpdateMeDto } from './dto/update-me.dto';

/**
 * A resolved cookie. `refreshed` asks the caller to re-send it: the row now
 * lives longer than the browser's copy says it does.
 */
export interface ResolvedSession {
  user: UserPublic | null;
  refreshed: boolean;
}

/**
 * Verified against on a sign-in attempt for an unknown address, so a wrong
 * email and a wrong password cost the same time. It must be well-formed —
 * 16-byte salt, 64-byte key, both hex — or `verifyPassword` rejects it before
 * doing the work that makes the timings match.
 */
const DECOY_HASH = `${'0'.repeat(32)}:${'0'.repeat(128)}`;

/**
 * How long a reset link stays usable. Short, because it is handed over by
 * whatever channel the admin has at hand and lives there afterwards — a link
 * that outlives the conversation carrying it is a password lying around.
 */
export const RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly throttle: LoginThrottle,
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
   *
   * The lifetime is an idle one, so a session still being used is pushed back
   * — but only past its halfway point, which turns what would be a write per
   * request into one every six hours.
   */
  async resolve(token: string | null): Promise<ResolvedSession> {
    if (!token) return { user: null, refreshed: false };
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session) return { user: null, refreshed: false };

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      await this.prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return { user: null, refreshed: false };
    }

    const refreshed = session.expiresAt.getTime() - now < SESSION_TTL_MS / 2;
    if (refreshed) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { expiresAt: new Date(now + SESSION_TTL_MS) },
      });
    }
    return { user: toPublic(session.user), refreshed };
  }

  /**
   * Verifies the credentials and opens a session. Every failure answers the
   * same code: which half was wrong is precisely what an attacker is asking.
   * Failures are counted, and enough of them close the door for a while —
   * see `LoginThrottle` for what is counted against whom.
   */
  async login(dto: LoginDto, ip: string): Promise<{ user: UserPublic; token: string }> {
    const keys = { email: normalizeEmail(dto.email), ip };
    const wait = this.throttle.retryAfter(keys);
    if (wait > 0) {
      throw new CodedException('errors.auth.tooManyAttempts', HttpStatus.TOO_MANY_REQUESTS, {
        minutes: Math.ceil(wait / 60_000),
      });
    }

    const user = await this.prisma.user.findUnique({ where: { email: keys.email } });
    const ok = await verifyPassword(dto.password, user?.passwordHash ?? DECOY_HASH);
    if (!user || !ok) {
      this.throttle.recordFailure(keys);
      throw new CodedException('errors.auth.invalidCredentials', HttpStatus.UNAUTHORIZED);
    }
    this.throttle.clear(keys);

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

  /**
   * What an account may change about itself: its name, and its password on
   * presenting the current one. Not its role, and not its address — those are
   * how an admin identifies it, so they stay with the admins.
   */
  async updateSelf(id: string, dto: UpdateMeDto, keepToken: string | null): Promise<UserPublic> {
    const current = await this.byId(id);
    if (dto.password !== undefined) {
      // Re-authentication: a borrowed browser must not become a stolen account.
      const ok = await verifyPassword(dto.currentPassword ?? '', current.passwordHash);
      if (!ok) throw new CodedException('errors.auth.wrongPassword', HttpStatus.BAD_REQUEST);
    }
    // Written here rather than through updateUser: how somebody reads the
    // application is their own business, and no admin route sets it for them.
    // Undefined leaves the column alone, null clears it back to the default.
    if (dto.displayDirection !== undefined || dto.displayMode !== undefined) {
      await this.prisma.user.update({
        where: { id },
        data: { displayDirection: dto.displayDirection, displayMode: dto.displayMode },
      });
    }
    return this.updateUser(id, { name: dto.name, password: dto.password }, keepToken);
  }

  // ─── Reset links ───────────────────────────────────────────────────

  /**
   * Mints a link for an account that can no longer sign in, and returns its
   * token — the only time it is readable. Issuing one drops that account's
   * previous links, so the newest is always the only one that works.
   *
   * Nothing is sent anywhere: the admin hands the link over by whatever channel
   * they already have. That is the whole feature, and it is what lets it exist
   * without this install having to know how to send mail.
   */
  async issueResetLink(userId: string): Promise<PasswordResetIssued> {
    await this.byId(userId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);

    await this.prisma.$transaction([
      this.prisma.passwordReset.deleteMany({ where: { userId } }),
      this.prisma.passwordReset.create({
        data: { tokenHash: hashToken(token), userId, expiresAt },
      }),
    ]);
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** Whose password this link would change — shown before anything is typed. */
  async resetTarget(token: string): Promise<PasswordResetTarget> {
    const { user } = await this.findReset(token);
    return { email: user.email, name: user.name };
  }

  /**
   * Spends the link: new password, every session of that account closed, and
   * every link for it gone — including this one, which is what makes it single
   * use. No session is opened in exchange; signing in is the proof it worked.
   */
  async consumeResetLink(token: string, password: string): Promise<void> {
    const reset = await this.findReset(token);
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
      this.prisma.session.deleteMany({ where: { userId: reset.userId } }),
      this.prisma.passwordReset.deleteMany({ where: { userId: reset.userId } }),
    ]);
  }

  /**
   * An expired link answers differently from an unknown one: the token is the
   * secret here, so there is nothing to hide by conflating them, and "it has
   * expired" is the difference between asking for a new link and giving up.
   */
  private async findReset(token: string) {
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!reset) throw new CodedException('errors.auth.resetInvalid', HttpStatus.BAD_REQUEST);
    if (reset.expiresAt <= new Date()) {
      await this.prisma.passwordReset.delete({ where: { id: reset.id } }).catch(() => undefined);
      throw new CodedException('errors.auth.resetExpired', HttpStatus.BAD_REQUEST);
    }
    return reset;
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
  displayDirection: string | null;
  displayMode: string | null;
}): UserPublic {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    display: {
      // Narrowed on the way out rather than trusted: the columns are plain
      // text, and a value left by an older version must not reach the front.
      direction: OVERVIEW_DIRECTIONS.find((d) => d === u.displayDirection) ?? null,
      mode: DISPLAY_MODES.find((m) => m === u.displayMode) ?? null,
    },
  };
}
