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

  /** Every rule; each names the tracker it belongs to. */
  @Get('ticket-rules')
  async list(@Query() query: PaginationQueryDto) {
    return this.ticketRules.findAll(toWindow(query, await this.settings.pageSize()));
  }

  @Post('ticket-rules')
  create(@Body() dto: CreateTicketRuleDto) {
    return this.ticketRules.create(dto);
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

  /** Runs every saved rule over a sample branch and title. */
  @Post('ticket-rules/preview')
  @HttpCode(200)
  preview(@Body() dto: PreviewTicketRulesDto) {
    return this.ticketRules.preview(dto);
  }
}
