import { Module } from '@nestjs/common';
import { SolanaTrackerService } from './solana-tracker.service';
import { CopyTradeModule } from '../copy-trade/copy-trade.module';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '../cache/cache.module';
import { SolanaModule } from 'src/solana/solana.module';
import { SharedWebSocketModule } from '../websocket/shared-websocket.module';

@Module({
    imports: [
        CopyTradeModule,
        ConfigModule,
        CacheModule,
        SolanaModule,
        SharedWebSocketModule,
    ],
    providers: [SolanaTrackerService],
    exports: [SolanaTrackerService],
})
export class SolanaTrackerModule { }
