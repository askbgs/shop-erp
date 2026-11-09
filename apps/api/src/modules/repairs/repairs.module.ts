import { Module } from '@nestjs/common';
import { PublicRepairsController, RepairsController } from './repairs.controller';
import { RepairsService } from './repairs.service';

@Module({ controllers: [RepairsController, PublicRepairsController], providers: [RepairsService] })
export class RepairsModule {}
