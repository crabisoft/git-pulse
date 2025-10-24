import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';

/**
 * Global, and it registers the guard for the whole application: access is a
 * property of every route, not something a module opts into.
 */
@Global()
@Module({
  controllers: [AuthController, UsersController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
