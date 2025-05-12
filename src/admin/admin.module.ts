import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGateway } from './admin.gateway';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import { SolanaListCategoriesToken } from '../solana/entities/solana-list-categories-token.entity';
import { Setting } from './entities/setting.entity';
import { UserAdmin } from './entities/user-admin.entity';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([ListWallet, SolanaListCategoriesToken, Setting, UserAdmin]),
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminGateway, JwtStrategy],
  exports: [AdminService, AdminGateway],
})
export class AdminModule {}
