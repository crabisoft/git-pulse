import { Module } from '@nestjs/common';
import { TicketRulesService } from './ticket-rules.service';
import { TicketRulesController } from './ticket-rules.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [TicketRulesController],
  providers: [TicketRulesService],
  exports: [TicketRulesService],
})
export class TicketRulesModule {}
