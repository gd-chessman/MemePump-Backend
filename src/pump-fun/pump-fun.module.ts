import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { PumpFunService } from './pump-fun.service';

@Module({
    imports: [
        HttpModule,
        ConfigModule,
    ],
    providers: [PumpFunService],
    exports: [PumpFunService]
})
export class PumpFunModule { } 