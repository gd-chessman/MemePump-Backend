import { Module, forwardRef } from '@nestjs/common';
import { OnChainController } from './on-chain.controller';
import { OnChainService } from './on-chain.service';
import { JwtModule } from '@nestjs/jwt';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SolanaModule } from '../solana/solana.module';
import { CacheModule } from '../cache/cache.module';
import { SharedWebSocketModule } from '../websocket/shared-websocket.module';
import { BirdeyeService } from './birdeye.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '1d' },
    }),
    EventEmitterModule.forRoot(),
    forwardRef(() => SolanaModule),
    CacheModule,
    SharedWebSocketModule
  ],
  controllers: [OnChainController],
  providers: [OnChainService, BirdeyeService],
  exports: [OnChainService, BirdeyeService]
})
export class OnChainModule { }
