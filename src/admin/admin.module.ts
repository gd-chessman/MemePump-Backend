import { Module, OnModuleInit } from '@nestjs/common';
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
import { AdminJwtStrategy } from './strategies/jwt.strategy';
import { UserWallet } from '../telegram-wallets/entities/user-wallet.entity';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import * as path from 'path';

@Module({
  imports: [
    TypeOrmModule.forFeature([ListWallet, SolanaListCategoriesToken, Setting, UserAdmin, UserWallet]),
    PassportModule.register({ defaultStrategy: 'admin-jwt' }),
    JwtModule.register({
      secret: 'your-secret-key',
      signOptions: { expiresIn: '1d' },
    }),
    MulterModule.register({
      storage: diskStorage({
        destination: './src/admin/uploads',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminGateway, AdminJwtStrategy],
  exports: [AdminService, AdminGateway],
})
export class AdminModule implements OnModuleInit {
  onModuleInit() {
    const uploadsDir = path.join(process.cwd(), 'src', 'admin', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
  }
}
