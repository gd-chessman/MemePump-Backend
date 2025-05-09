import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ListWallet } from './entities/list-wallet.entity';
import { UserWallet } from './entities/user-wallet.entity';
import { WalletAuth } from './entities/wallet-auth.entity';
import { TelegramWalletsController } from './telegram-wallets.controller';
import { TelegramWalletsService } from './telegram-wallets.service';
import { ConfigModule } from '@nestjs/config';
import { SolanaModule } from '../solana/solana.module';
import { UserWalletCode } from './entities/user-wallet-code.entity';
import { SolanaListToken } from '../solana/entities/solana-list-token.entity';
import { SolanaListCategoriesToken } from '../solana/entities/solana-list-categories-token.entity';
import { SolanaTokenJoinCategory } from '../solana/entities/solana-token-join-category.entity';
import { CacheModule } from '../cache/cache.module';
import { ChatsModule } from '../chats/chats.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserWalletCode,
      ListWallet,
      UserWallet,
      WalletAuth,
      SolanaListToken,
      SolanaListCategoriesToken,
      SolanaTokenJoinCategory
    ]),
    ConfigModule,
    SolanaModule,
    CacheModule,
    forwardRef(() => ChatsModule)
  ],
  controllers: [TelegramWalletsController],
  providers: [TelegramWalletsService],
  exports: [TelegramWalletsService]
})
export class TelegramWalletsModule { }
