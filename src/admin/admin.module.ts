import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGateway } from './admin.gateway';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import { SolanaListCategoriesToken } from '../solana/entities/solana-list-categories-token.entity';
import { Setting } from './entities/setting.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ListWallet, SolanaListCategoriesToken, Setting])
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminGateway],
  exports: [AdminService, AdminGateway],
})
export class AdminModule {}
