import { Global, Module } from '@nestjs/common';
import { PaymentsController, SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Global()
@Module({ controllers: [SalesController, PaymentsController], providers: [SalesService], exports: [SalesService] })
export class SalesModule {}
