import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TokenGateway } from './token.gateway';
import { ChartGateway } from './chart.gateway';
import { TradeGateway } from './trade.gateway';
import { OnChainModule } from '../on-chain/on-chain.module';
import { SolanaModule } from '../solana/solana.module';
import { TradeModule } from '../trade/trade.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TradeService } from '../trade/trade.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SolanaListToken } from '../solana/entities/solana-list-token.entity';
import { TokenTxsGateway } from './token-txs.gateway';
import { TokenInfoGateway } from './token-info.gateway';

@Module({
    imports: [
        OnChainModule,
        SolanaModule,
        forwardRef(() => TradeModule),
        EventEmitterModule.forRoot(),
        TypeOrmModule.forFeature([SolanaListToken]),
        ConfigModule
    ],
    providers: [
        TokenGateway,
        ChartGateway,
        TradeGateway,
        TokenTxsGateway,
        TokenInfoGateway
    ],
    exports: [
        TokenGateway,
        ChartGateway,
        TradeGateway,
        TokenTxsGateway,
        TokenInfoGateway
    ]
})
export class WebSocketModule { } 