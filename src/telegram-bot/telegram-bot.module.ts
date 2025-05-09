import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { TelegramBotService } from './telegram-bot.service';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import { TelegramWalletsModule } from 'src/telegram-wallets/telegram-wallets.module';
import { SolanaModule } from '../solana/solana.module';
import { UserWallet } from 'src/telegram-wallets/entities/user-wallet.entity';
import { WalletAuth } from 'src/telegram-wallets/entities/wallet-auth.entity';
import { UserWalletCode } from 'src/telegram-wallets/entities/user-wallet-code.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      ListWallet, 
      UserWallet, 
      WalletAuth,
      UserWalletCode
    ]),
    forwardRef(() => TelegramWalletsModule),
    forwardRef(() => SolanaModule),
  ],
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramBotModule { }
