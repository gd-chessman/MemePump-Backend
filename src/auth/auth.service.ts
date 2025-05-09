import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TelegramWalletsService } from '../telegram-wallets/telegram-wallets.service';
import { InjectRepository } from '@nestjs/typeorm';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import { WalletAuth } from '../telegram-wallets/entities/wallet-auth.entity';
import { Repository } from 'typeorm';

@Injectable()
export class AuthService {
    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly telegramWalletsService: TelegramWalletsService,
        @InjectRepository(ListWallet)
        private listWalletRepository: Repository<ListWallet>,
        @InjectRepository(WalletAuth)
        private walletAuthRepository: Repository<WalletAuth>,
    ) { }

    async refreshToken(user: any) {
        if (!user) {
            throw new UnauthorizedException('Invalid user');
        }

        if (!user.uid || !user.wallet_id) {
            throw new UnauthorizedException('Invalid token payload structure');
        }

        const wallet = await this.listWalletRepository.findOne({
            where: { wallet_id: user.wallet_id }
        });

        if (!wallet) {
            throw new UnauthorizedException('Wallet not found');
        }

        const walletAuth = await this.walletAuthRepository.findOne({
            where: {
                wa_user_id: user.uid,
                wa_wallet_id: user.wallet_id
            }
        });

        if (!walletAuth) {
            throw new UnauthorizedException('User and wallet are no longer connected');
        }

        const payload = {
            uid: user.uid,
            wallet_id: user.wallet_id,
            sol_public_key: wallet.wallet_solana_address,
            eth_public_key: wallet.wallet_eth_address,
        };

        const newToken = this.jwtService.sign(payload, {
            secret: this.configService.get<string>('JWT_SECRET'),
            expiresIn: this.configService.get<string>('JWT_EXPIRATION', '86400'),
        });

        return {
            status: 200,
            token: newToken,
        };
    }
}
