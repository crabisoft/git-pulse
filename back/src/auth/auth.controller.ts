import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthState, UserPublic } from '@repo/shared';
import { AuthService } from './auth.service';
import { Account, Anonymous, CurrentUser } from './access.decorator';
import { clearSessionCookie, isSecureDeployment, readSessionCookie, setSessionCookie } from './session-cookie';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import type { AuthenticatedRequest } from './authenticated-request';

/**
 * Anonymous throughout: these are the routes that must answer before there is a
 * session — and signing out of an expired session has to succeed too.
 */
@Anonymous()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Everything the frontend needs to decide what to render, in one call. */
  @Get('me')
  me(@CurrentUser() user: UserPublic | null): Promise<AuthState> {
    return this.auth.state(user);
  }

  /** What this account may change about itself — see `UpdateMeDto` for the rest. */
  @Account()
  @Patch('me')
  async updateMe(
    @Body() dto: UpdateMeDto,
    @CurrentUser() user: UserPublic,
    @Req() req: AuthenticatedRequest,
  ): Promise<AuthState> {
    // Changing the password ends the account's other sessions, never this one.
    return this.auth.state(await this.auth.updateSelf(user.id, dto, readSessionCookie(req)));
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthState> {
    const { user, token } = await this.auth.login(dto, req.ip ?? 'unknown');
    setSessionCookie(res, token, isSecureDeployment());
    return this.auth.state(user);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(readSessionCookie(req));
    clearSessionCookie(res, isSecureDeployment());
  }

  /** First admin of a fresh install. Rejected as soon as one account exists. */
  @Post('setup')
  @HttpCode(201)
  async setup(
    @Body() dto: CreateUserDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthState> {
    const { user, token } = await this.auth.setup(dto);
    setSessionCookie(res, token, isSecureDeployment());
    return this.auth.state(user);
  }
}
