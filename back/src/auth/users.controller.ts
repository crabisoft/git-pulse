import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SettingsService } from '../settings/settings.service';
import { PaginationQueryDto, toWindow } from '../common/pagination';
import { readSessionCookie } from './session-cookie';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import type { AuthenticatedRequest } from './authenticated-request';

/** Admin-only, by the guard's default. Accounts are not self-service here. */
@Controller('users')
export class UsersController {
  constructor(
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async findAll(@Query() query: PaginationQueryDto) {
    return this.auth.findAll(toWindow(query, await this.settings.pageSize()));
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.auth.createUser(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: AuthenticatedRequest) {
    // The caller's own session survives a change to their own account.
    return this.auth.updateUser(id, dto, readSessionCookie(req));
  }

  /**
   * A one-shot link for an account that can no longer sign in. The token comes
   * back once, for the admin to hand over — nothing is sent from here.
   */
  @Post(':id/reset-link')
  @HttpCode(200)
  issueResetLink(@Param('id') id: string) {
    return this.auth.issueResetLink(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.auth.removeUser(id);
  }
}
