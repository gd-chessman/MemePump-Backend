import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SolanaListCategoriesToken } from '../solana/entities/solana-list-categories-token.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([SolanaListCategoriesToken])
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
