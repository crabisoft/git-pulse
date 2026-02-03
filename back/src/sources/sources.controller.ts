import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SourcesService } from './sources.service';
import { CreateSourceDto } from './dto/create-source.dto';
import { UpdateSourceDto } from './dto/update-source.dto';
import { PaginationQueryDto, toWindow } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';
import { Viewer } from '../auth/access.decorator';

@Controller('sources')
export class SourcesController {
  constructor(
    private readonly sources: SourcesService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Read by everyone the dashboard is open to: it is what fills the source
   * picker. No credential is part of the payload — only what a source is.
   * Creating, editing and testing one stays with the admins.
   */
  @Viewer()
  @Get()
  async findAll(@Query() query: PaginationQueryDto) {
    return this.sources.findAll(toWindow(query, await this.settings.pageSize()));
  }

  @Viewer()
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sources.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSourceDto) {
    return this.sources.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSourceDto) {
    return this.sources.update(id, dto);
  }

  /**
   * Makes this source the one a reader lands on when the address names none.
   *
   * A route of its own rather than a field on the update: it is the only write
   * here that changes another row, and PATCHing one source to un-favourite
   * another reads as a side effect nobody asked for.
   */
  @Post(':id/default')
  @HttpCode(200)
  makeDefault(@Param('id') id: string) {
    return this.sources.makeDefault(id);
  }

  @Post(':id/test')
  @HttpCode(200)
  test(@Param('id') id: string) {
    return this.sources.testConnection(id);
  }

  /**
   * The repos the selection is picked from — everything the owner exposes, not
   * only what the scope keeps. Admin-only like the rest of the editing: it
   * spends a provider call, and it also tells whoever asks which private
   * repositories exist.
   */
  @Get(':id/repositories')
  repositories(@Param('id') id: string) {
    return this.sources.listRepositories(id);
  }

  /**
   * Issues the webhook secret and returns it — the one and only time it is
   * readable, exactly like a source credential. Calling it again rotates,
   * which is the whole of what recovering from a leak takes. Admin-only, like
   * everything that touches a secret.
   */
  @Post(':id/webhook')
  @HttpCode(200)
  issueWebhookSecret(@Param('id') id: string) {
    return this.sources.issueWebhookSecret(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.sources.remove(id);
  }
}
