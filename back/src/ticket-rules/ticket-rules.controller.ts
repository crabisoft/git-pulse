import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { TicketRulesService } from './ticket-rules.service';
import { PaginationQueryDto, toWindow } from '../common/pagination';
import { SettingsService } from '../settings/settings.service';
import { CreateTicketRuleDto } from './dto/create-ticket-rule.dto';
import { UpdateTicketRuleDto } from './dto/update-ticket-rule.dto';
import { PreviewTicketRulesDto } from './dto/preview-ticket-rules.dto';

@Controller()
export class TicketRulesController {
  constructor(
    private readonly ticketRules: TicketRulesService,
    private readonly settings: SettingsService,
  ) {}

  @Get('sources/:sourceId/ticket-rules')
  async list(@Param('sourceId') sourceId: string, @Query() query: PaginationQueryDto) {
    return this.ticketRules.findBySource(sourceId, toWindow(query, await this.settings.pageSize()));
  }

  @Post('sources/:sourceId/ticket-rules')
  create(@Param('sourceId') sourceId: string, @Body() dto: CreateTicketRuleDto) {
    return this.ticketRules.create(sourceId, dto);
  }

  @Patch('ticket-rules/:id')
  update(@Param('id') id: string, @Body() dto: UpdateTicketRuleDto) {
    return this.ticketRules.update(id, dto);
  }

  @Delete('ticket-rules/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.ticketRules.remove(id);
  }

  /** Runs the source's saved rules over a sample branch and title. */
  @Post('sources/:sourceId/ticket-rules/preview')
  @HttpCode(200)
  preview(@Param('sourceId') sourceId: string, @Body() dto: PreviewTicketRulesDto) {
    return this.ticketRules.preview(sourceId, dto);
  }
}
