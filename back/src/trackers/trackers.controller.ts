import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { TrackersService } from './trackers.service';
import { PaginationQueryDto, toWindow } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';
import { CreateTrackerDto } from './dto/create-tracker.dto';
import { UpdateTrackerDto } from './dto/update-tracker.dto';

@Controller()
export class TrackersController {
  constructor(
    private readonly trackers: TrackersService,
    private readonly settings: SettingsService,
  ) {}

  @Get('trackers')
  async list(@Query() query: PaginationQueryDto) {
    return this.trackers.findAll(toWindow(query, await this.settings.pageSize()));
  }

  /** Trackers attached to a source — what its ticket rules may point at. */
  @Get('sources/:sourceId/trackers')
  listForSource(@Param('sourceId') sourceId: string) {
    return this.trackers.findBySource(sourceId);
  }

  @Post('trackers')
  create(@Body() dto: CreateTrackerDto) {
    return this.trackers.create(dto);
  }

  @Patch('trackers/:id')
  update(@Param('id') id: string, @Body() dto: UpdateTrackerDto) {
    return this.trackers.update(id, dto);
  }

  @Delete('trackers/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.trackers.remove(id);
  }
}
