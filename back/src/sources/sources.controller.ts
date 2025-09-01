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

@Controller('sources')
export class SourcesController {
  constructor(
    private readonly sources: SourcesService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  async findAll(@Query() query: PaginationQueryDto) {
    return this.sources.findAll(toWindow(query, await this.settings.pageSize()));
  }

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

  @Post(':id/test')
  @HttpCode(200)
  test(@Param('id') id: string) {
    return this.sources.testConnection(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.sources.remove(id);
  }
}
