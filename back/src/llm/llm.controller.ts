import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { LlmService } from './llm.service';
import { PaginationQueryDto, toWindow } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';
import { Account } from '../auth/access.decorator';
import { CreateLlmProviderDto } from './dto/create-llm-provider.dto';
import { UpdateLlmProviderDto } from './dto/update-llm-provider.dto';

/**
 * Configuration, so admin-only by the global guard's default — the keys
 * declared here are spent by whoever can reach them.
 */
@Controller()
export class LlmController {
  constructor(
    private readonly llm: LlmService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Open to any account, unlike the rest of this controller: rewriting release
   * notes is, so choosing which model does it has to be too. The payload names
   * providers and models and says whether a key is on file — never the key.
   */
  @Account()
  @Get('llm-providers')
  async list(@Query() query: PaginationQueryDto) {
    return this.llm.findAll(toWindow(query, await this.settings.pageSize()));
  }

  @Post('llm-providers')
  create(@Body() dto: CreateLlmProviderDto) {
    return this.llm.create(dto);
  }

  @Patch('llm-providers/:id')
  update(@Param('id') id: string, @Body() dto: UpdateLlmProviderDto) {
    return this.llm.update(id, dto);
  }

  @Delete('llm-providers/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.llm.remove(id);
  }

  /** Spends one call to prove the key, the model and the endpoint together. */
  @Post('llm-providers/:id/test')
  test(@Param('id') id: string) {
    return this.llm.testConnection(id);
  }
}
