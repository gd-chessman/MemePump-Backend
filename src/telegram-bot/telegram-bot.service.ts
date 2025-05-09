import { Injectable, OnModuleInit, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
const TelegramBot = require('node-telegram-bot-api');
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { ethers } from 'ethers';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import { UserWalletCode } from 'src/telegram-wallets/entities/user-wallet-code.entity';
import { randomBytes } from 'crypto';
import { TelegramWalletsService } from '../telegram-wallets/telegram-wallets.service';
import { SolanaService } from '../solana/solana.service';
import { createHash } from 'crypto';
import { UserWallet } from 'src/telegram-wallets/entities/user-wallet.entity';
import { WalletAuth } from 'src/telegram-wallets/entities/wallet-auth.entity';

@Injectable()
export class TelegramBotService implements OnModuleInit {
    private bot: any;
    private botToken: string;
    private frontendUrl: string;
    private readonly logger = new Logger(TelegramBotService.name);

    constructor(
        private configService: ConfigService,
        @InjectRepository(ListWallet)
        private listWalletRepository: Repository<ListWallet>,
        @InjectRepository(UserWallet)
        private userWalletRepository: Repository<UserWallet>,
        @InjectRepository(WalletAuth)
        private walletAuthRepository: Repository<WalletAuth>,
        @InjectRepository(UserWalletCode)
        private userWalletCodeRepository: Repository<UserWalletCode>,
        private readonly telegramWalletsService: TelegramWalletsService,
        private readonly solanaService: SolanaService,
    ) {
        this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN', '');
        this.frontendUrl = this.configService.get<string>('URL_FRONTEND', '');

        if (!this.botToken) {
            throw new Error('TELEGRAM_BOT_TOKEN is missing in .env file');
        }

        if (!this.frontendUrl) {
            throw new Error('URL_FRONTEND is missing in .env file');
        }

        this.bot = new TelegramBot(this.botToken, { polling: true });
    }

    async getOrCreateWallet(telegramId: string): Promise<{ solana: string; ethereum: string; bsc: string; solanaPrivateKey: string; ethPrivateKey: string; code: string; websiteLink: string; }> {
        try {
            this.logger.log(`Creating or getting wallet for Telegram ID: ${telegramId}`);
            
            // Kiểm tra nếu user đã tồn tại trong bảng user_wallets
            let userWallet = await this.userWalletRepository.findOne({ 
                where: { uw_telegram_id: telegramId },
                relations: ['wallet_auths', 'wallet_auths.wa_wallet']
            });

            let listWallet: ListWallet;
            let isNewUser = false;

            // Nếu user chưa tồn tại, tạo mới user và wallet
            if (!userWallet) {
                isNewUser = true;
                this.logger.log(`Creating new user for Telegram ID: ${telegramId}`);
                
                // Tạo Solana keypair ngẫu nhiên
                const solanaKeypair = Keypair.generate();
                const solanaPublicKey = solanaKeypair.publicKey.toBase58();
                const solanaPrivateKey = bs58.encode(solanaKeypair.secretKey);

                // Tạo Ethereum private key từ Solana private key
                const ethPrivateKey = this.deriveEthereumPrivateKey(solanaKeypair.secretKey);
                const ethWallet = new ethers.Wallet(ethPrivateKey);
                const ethAddress = ethWallet.address;

                // 1. Tạo user mới
                userWallet = this.userWalletRepository.create({
                    uw_telegram_id: telegramId
                });
                await this.userWalletRepository.save(userWallet);

                // 2. Tạo ví mới
                listWallet = this.listWalletRepository.create({
                    wallet_private_key: JSON.stringify({
                        solana: solanaPrivateKey,
                        ethereum: ethPrivateKey
                    }),
                    wallet_solana_address: solanaPublicKey,
                    wallet_eth_address: ethAddress,
                    wallet_status: true,
                    wallet_auth: 'member'
                });
                await this.listWalletRepository.save(listWallet);

                // 3. Tạo liên kết wallet_auth
                const walletAuth = this.walletAuthRepository.create({
                    wa_user_id: userWallet.uw_id,
                    wa_wallet_id: listWallet.wallet_id,
                    wa_type: 'main'
                });
                await this.walletAuthRepository.save(walletAuth);
                
                this.logger.log(`Created new wallet for user ${telegramId}: ${solanaPublicKey}`);
            } else {
                this.logger.log(`Found existing user for Telegram ID: ${telegramId}`);
                // Nếu user đã tồn tại, lấy ví chính (main wallet)
                if (userWallet.wallet_auths && userWallet.wallet_auths.length > 0) {
                    const mainWalletAuth = userWallet.wallet_auths.find(auth => auth.wa_type === 'main');
                    if (mainWalletAuth && mainWalletAuth.wa_wallet) {
                        listWallet = mainWalletAuth.wa_wallet;
                    } else {
                        // Nếu không tìm thấy ví chính, sử dụng ví đầu tiên
                        listWallet = userWallet.wallet_auths[0].wa_wallet;
                    }
                    
                    // ✨ Cập nhật địa chỉ ví từ private key
                    await this.updateWalletAddresses(listWallet);
                } else {
                    this.logger.log(`User ${telegramId} exists but has no wallet, creating new wallet`);
                    // Trường hợp có user nhưng không có ví (hiếm gặp)
                    // Tạo ví mới và liên kết
                    const solanaKeypair = Keypair.generate();
                    const solanaPublicKey = solanaKeypair.publicKey.toBase58();
                    const solanaPrivateKey = bs58.encode(solanaKeypair.secretKey);
                    const ethPrivateKey = this.deriveEthereumPrivateKey(solanaKeypair.secretKey);
                    const ethWallet = new ethers.Wallet(ethPrivateKey);
                    
                    listWallet = this.listWalletRepository.create({
                        wallet_private_key: JSON.stringify({
                            solana: solanaPrivateKey,
                            ethereum: ethPrivateKey
                        }),
                        wallet_solana_address: solanaPublicKey,
                        wallet_eth_address: ethWallet.address,
                        wallet_status: true,
                        wallet_auth: 'member'
                    });
                    await this.listWalletRepository.save(listWallet);

                    const walletAuth = this.walletAuthRepository.create({
                        wa_user_id: userWallet.uw_id,
                        wa_wallet_id: listWallet.wallet_id,
                        wa_type: 'main'
                    });
                    await this.walletAuthRepository.save(walletAuth);
                }
            }

            // Parse private key từ ví
            const privateKeyObj = JSON.parse(listWallet.wallet_private_key);
            const solanaPrivateKey = privateKeyObj.solana;
            const ethPrivateKey = privateKeyObj.ethereum;

            // Tạo code mới và lưu vào user_wallet_code
            const code = await this.generateNewCode(userWallet);
            this.logger.log(`Created wallet code for user ${telegramId}`);

            // Tạo link website với telegram_id và code
            const websiteLink = `${this.frontendUrl}/tglogin?id=${telegramId}&code=${code}`;
            this.logger.log(`Generated login link for user ${telegramId}`);

            return {
                solana: listWallet.wallet_solana_address,
                ethereum: listWallet.wallet_eth_address,
                bsc: listWallet.wallet_eth_address, // BSC sử dụng cùng địa chỉ với ETH
                solanaPrivateKey: solanaPrivateKey,
                ethPrivateKey: ethPrivateKey,
                code: code,
                websiteLink: websiteLink,
            };
        } catch (error) {
            this.logger.error(`Error in getOrCreateWallet: ${error.message}`, error.stack);
            throw error;
        }
    }

    /**
     * Tạo Ethereum private key từ Solana private key
     * @param solanaSecretKey Uint8Array Solana secret key
     * @returns Ethereum private key (hex string with 0x prefix)
     */
    private deriveEthereumPrivateKey(solanaSecretKey: Uint8Array): string {
        // Lấy 32 bytes đầu tiên từ Solana secret key
        const ethPrivateKeyBytes = solanaSecretKey.slice(0, 32);

        // Chuyển đổi sang hex string và thêm prefix 0x
        const ethPrivateKey = '0x' + Buffer.from(ethPrivateKeyBytes).toString('hex');

        // Kiểm tra tính hợp lệ của private key
        try {
            new ethers.Wallet(ethPrivateKey);
            return ethPrivateKey;
        } catch (error) {
            throw new Error('Invalid Ethereum private key generated');
        }
    }

    // Thêm phương thức để cập nhật địa chỉ ví từ private key
    private async updateWalletAddresses(wallet: ListWallet): Promise<ListWallet> {
        try {
            let updated = false;
            const privateKeyObject = JSON.parse(wallet.wallet_private_key);

            // Cập nhật địa chỉ Solana
            if (privateKeyObject.solana) {
                try {
                    const solanaKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyObject.solana));
                    const solanaAddress = solanaKeypair.publicKey.toBase58();
                    
                    if (wallet.wallet_solana_address !== solanaAddress) {
                        wallet.wallet_solana_address = solanaAddress;
                        updated = true;
                        this.logger.log(`Updated Solana address for wallet ${wallet.wallet_id} to ${solanaAddress}`);
                    }
                } catch (e) {
                    this.logger.error(`Error updating Solana address: ${e.message}`);
                }
            }

            // Cập nhật địa chỉ Ethereum
            if (privateKeyObject.ethereum) {
                try {
                    const ethWallet = new ethers.Wallet(privateKeyObject.ethereum);
                    
                    if (wallet.wallet_eth_address !== ethWallet.address) {
                        wallet.wallet_eth_address = ethWallet.address;
                        updated = true;
                        this.logger.log(`Updated Ethereum address for wallet ${wallet.wallet_id} to ${ethWallet.address}`);
                    }
                } catch (e) {
                    this.logger.error(`Error updating Ethereum address: ${e.message}`);
                }
            }

            // Lưu nếu có thay đổi
            if (updated) {
                await this.listWalletRepository.save(wallet);
            }

            return wallet;
        } catch (error) {
            this.logger.error('Error updating wallet addresses:', error);
            return wallet;
        }
    }

    async generateNewCode(userWallet: UserWallet): Promise<string> {
        // Generate a random hex string using crypto
        const code = randomBytes(16).toString('hex');
        
        // Create dates in UTC
        const now = new Date();
        const expirationTime = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes
        
        this.logger.debug('Generating new code:', {
            code,
            now: now.toISOString(),
            expirationTime: expirationTime.toISOString(),
            nowLocal: now.toString(),
            expirationTimeLocal: expirationTime.toString()
        });

        // Create new UserWalletCode entity
        const userWalletCode = this.userWalletCodeRepository.create({
            tw_wallet_id: userWallet.uw_id,
            tw_code_value: code,
            tw_code_time: expirationTime,
            tw_code_status: true,
            tw_code_type: 1
        });

        // Save to database using TypeORM
        await this.userWalletCodeRepository.save(userWalletCode);

        return code;
    }

    onModuleInit() {
        this.logger.log('🚀 Telegram bot started');
        
        this.bot.on('polling_error', () => {
            this.logger.error('Bot polling failed');
        });
        
        // Xử lý lệnh /start
        this.bot.onText(/\/start/, async (msg) => {
            try {
                const chatId = msg.chat.id;
                const telegramId = msg.from?.id?.toString() || '';

                if (!telegramId) {
                    this.bot.sendMessage(chatId, '❌ Lỗi: Không thể xác định Telegram ID.');
                    return;
                }

                const wallets = await this.getOrCreateWallet(telegramId);
                const solBalance = await this.solanaService.getBalance(wallets.solana);

                const message = `
⭐️ *Log in to MemePump for trading in seconds* 🤘

💰 *Solana*: ${solBalance.toFixed(5)} SOL _(Please top up 👇)_
\`${wallets.solana}\`

💰 *Ethereum*: 0 ETH _(Please top up 👇)_
\`${wallets.ethereum}\`

💰 *BSC*: 0 BNB _(Please top up 👇)_
\`${wallets.bsc}\`
                `;

                const keyboard = {
                    inline_keyboard: [
                        [{ text: '🌐 Login Website', url: wallets.websiteLink }],
                    ],
                };

                this.bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard,
                });
                
            } catch (error) {
                this.logger.error('Start command failed');
                this.bot.sendMessage(msg.chat.id, '❌ Có lỗi xảy ra. Vui lòng thử lại sau.');
            }
        });
    }
}
