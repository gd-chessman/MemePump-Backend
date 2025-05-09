import { Injectable, NotFoundException, Logger, UseInterceptors, UploadedFile, Body, Req, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ManyToOne, JoinColumn } from 'typeorm';
import { UserWalletCode } from './entities/user-wallet-code.entity';
import { ListWallet } from './entities/list-wallet.entity';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { Keypair } from '@solana/web3.js';
import { ethers } from 'ethers';
import bs58 from 'bs58';
import ms from 'ms';
import { SolanaService } from '../solana/solana.service';
import { WalletPrivateKeysDto } from './dto/wallet-private-keys.dto';
import { UserWallet } from './entities/user-wallet.entity';
import { WalletAuth } from './entities/wallet-auth.entity';
import { AddWalletDto } from './dto/add-wallet.dto';
import { SolanaListToken } from '../solana/entities/solana-list-token.entity';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateTokenDto } from './dto/create-token.dto';
import { Express } from 'express';
import { Multer } from 'multer';
import { diskStorage } from 'multer';
import { SolanaListCategoriesToken, CategoryStatus } from '../solana/entities/solana-list-categories-token.entity';
import { SolanaTokenJoinCategory, JoinCategoryStatus } from '../solana/entities/solana-token-join-category.entity';
import { GetCategoriesResponseDto } from './dto/get-categories.dto';
import { SolanaListCategoriesTokenRepository } from '../solana/repositories/solana-list-categories-token.repository';
import { CacheService } from '../cache/cache.service';
import { SolanaPriceCacheService } from '../solana/solana-price-cache.service';

@Injectable()
export class TelegramWalletsService {
    private readonly logger = new Logger(TelegramWalletsService.name);

    constructor(
        @InjectRepository(UserWalletCode)
        private userWalletCodeRepository: Repository<UserWalletCode>,
        @InjectRepository(ListWallet)
        private listWalletRepository: Repository<ListWallet>,
        @InjectRepository(UserWallet)
        private userWalletRepository: Repository<UserWallet>,
        @InjectRepository(WalletAuth)
        private walletAuthRepository: Repository<WalletAuth>,
        @InjectRepository(SolanaListToken)
        private solanaListTokenRepository: Repository<SolanaListToken>,
        private readonly solanaListCategoriesTokenRepository: SolanaListCategoriesTokenRepository,
        @InjectRepository(SolanaTokenJoinCategory)
        private solanaTokenJoinCategoryRepository: Repository<SolanaTokenJoinCategory>,
        private configService: ConfigService,
        private solanaService: SolanaService,
        private readonly redisCacheService: CacheService,
        private readonly solanaPriceCacheService: SolanaPriceCacheService,
    ) { }

    async verifyWallet(telegramId: string, code: string) {
        this.logger.debug(`Verifying wallet for telegramId: ${telegramId} with code: ${code}`);

        // Find code in user_wallet_code table
        const walletCode = await this.findCode(telegramId, code);

        this.logger.debug('Found wallet code:', walletCode);

        if (!walletCode) {
            this.logger.debug('No wallet code found');
            return {
                status: 401,
                message: 'Invalid verification code'
            };
        }

        // Check code expiration and status
        const currentTime = new Date();
        const codeTime = new Date(walletCode.tw_code_time);

        // Log for debugging
        this.logger.debug('Time comparison:', {
            currentTime: currentTime.toISOString(),
            codeTime: codeTime.toISOString(),
            currentTimeLocal: currentTime.toString(),
            codeTimeLocal: codeTime.toString()
        });

        const isExpired = codeTime.getTime() < currentTime.getTime();
        if (isExpired || !walletCode.tw_code_status) {
            this.logger.debug(`Code expired or invalid status. isExpired: ${isExpired}, status: ${walletCode.tw_code_status}`);
            return { status: 401, message: 'Expired code' };
        }

        // Update code status to false
        walletCode.tw_code_status = false;
        await this.updateCodeStatus(walletCode);

        // Get JWT secret from config
        const jwtSecret = this.configService.get<string>('JWT_SECRET');
        if (!jwtSecret) {
            throw new Error('❌ JWT_SECRET is missing in environment variables');
        }

        const jwtExpiration = this.configService.get<string>('JWT_EXPIRATION', '86400');
        const expiresIn = parseInt(jwtExpiration, 10);

        // Find user and linked wallet
        const user = await this.userWalletRepository.findOne({
            where: { uw_telegram_id: telegramId },
        });

        if (!user) {
            return { status: 401, message: 'User not found' };
        }

        // Find all 'main' links of this user
        const mainWalletAuths = await this.walletAuthRepository.createQueryBuilder('wa')
            .leftJoinAndSelect('wa.wa_wallet', 'lw')
            .where('wa.wa_user_id = :userId', { userId: user.uw_id })
            .andWhere('wa.wa_type = :type', { type: 'main' })
            .orderBy('wa.wa_id', 'ASC')
            .getMany();

        let wallet: ListWallet;

        // Process based on 'main' link count
        if (mainWalletAuths.length === 1) {
            // Case with exactly 1 'main' link
            wallet = mainWalletAuths[0].wa_wallet;
        } else if (mainWalletAuths.length > 1) {
            // Case with multiple 'main' links
            // Use the oldest (lowest ID) link as the main link
            wallet = mainWalletAuths[0].wa_wallet;

            // Change other 'main' links to 'other'
            const otherMainWalletAuths = mainWalletAuths.slice(1);
            for (const auth of otherMainWalletAuths) {
                auth.wa_type = 'other';
                await this.walletAuthRepository.save(auth);
            }
        } else {
            // Case with no 'main' links
            // Create new wallet
            const solanaKeypair = Keypair.generate();
            const solanaPublicKey = solanaKeypair.publicKey.toBase58();
            const solanaPrivateKey = bs58.encode(solanaKeypair.secretKey);

            // Create Ethereum private key from Solana private key
            const ethPrivateKeyBytes = solanaKeypair.secretKey.slice(0, 32);
            const ethPrivateKey = '0x' + Buffer.from(ethPrivateKeyBytes).toString('hex');
            const ethWallet = new ethers.Wallet(ethPrivateKey);

            // Create new wallet in database
            const newWallet = this.listWalletRepository.create({
                wallet_private_key: JSON.stringify({
                    solana: solanaPrivateKey,
                    ethereum: ethPrivateKey
                }),
                wallet_solana_address: solanaPublicKey,
                wallet_eth_address: ethWallet.address,
                wallet_status: true,
                wallet_auth: 'member'
            });
            await this.listWalletRepository.save(newWallet);

            // Create 'main' link with new wallet
            const newWalletAuth = this.walletAuthRepository.create({
                wa_user_id: user.uw_id,
                wa_wallet_id: newWallet.wallet_id,
                wa_type: 'main'
            });
            await this.walletAuthRepository.save(newWalletAuth);

            wallet = newWallet;
        }

        // Create payload for JWT token
        const payload = {
            uid: user.uw_id,
            wallet_id: wallet.wallet_id,
            sol_public_key: wallet.wallet_solana_address,
            eth_public_key: wallet.wallet_eth_address,
        };

        // Define options
        const signOptions: jwt.SignOptions = {
            expiresIn,
            algorithm: 'HS256',
        };

        // Create token
        const token = jwt.sign(payload, jwtSecret, signOptions);

        return { status: 200, token };
    }

    async findCode(telegramId: string, code: string): Promise<UserWalletCode | null> {
        // Find user with telegram_id corresponding
        const user = await this.userWalletRepository.findOne({
            where: { uw_telegram_id: telegramId }
        });

        if (!user) {
            return null;
        }

        // Find code with user_id and code value
        return await this.userWalletCodeRepository.findOne({
            where: {
                tw_code_value: code,
                tw_wallet_id: user.uw_id,
                tw_code_status: true,
            }
        });
    }

    async updateCodeStatus(walletCode: UserWalletCode): Promise<void> {
        walletCode.tw_code_status = false;
        await this.userWalletCodeRepository.save(walletCode);
    }

    async createWalletCode(userWallet: UserWallet, code: string, expirationTime: Date): Promise<UserWalletCode> {
        const walletCode = this.userWalletCodeRepository.create({
            tw_wallet_id: userWallet.uw_id,
            tw_code_value: code,
            tw_code_type: 1,
            tw_code_time: expirationTime,
            tw_code_status: true,
        });
        return await this.userWalletCodeRepository.save(walletCode);
    }

    async getWalletInfo(req) {
        try {
            const wallet = await this.listWalletRepository.findOne({
                where: { wallet_id: req.user.wallet_id }
            });

            if (!wallet) {
                return {
                    status: 404,
                    message: 'Wallet not found',
                    data: null
                };
            }

            // Kiểm tra wallet_nick_name
            if (!wallet.wallet_nick_name) {
                return {
                    status: 403,
                    message: 'Wallet nickname is required',
                    data: null
                };
            }

            // Clear cache trước khi lấy số dư mới
            await this.solanaService.clearBalanceCache(wallet.wallet_solana_address);

            // Lấy số dư mới từ chain
            const solBalance = await this.solanaService.getBalance(wallet.wallet_solana_address);
            const solPrice = await this.solanaPriceCacheService.getSOLPriceInUSD();
            const solBalanceUSD = solBalance * solPrice;

            // Lấy wallet name từ walletAuth
            const walletAuth = await this.walletAuthRepository.findOne({
                where: {
                    wa_wallet_id: wallet.wallet_id,
                    wa_user_id: req.user.uid
                }
            });

            return {
                status: 200,
                message: 'Wallet info retrieved successfully',
                data: {
                    wallet_id: wallet.wallet_id,
                    wallet_name: walletAuth?.wa_name || null,
                    wallet_nick_name: wallet.wallet_nick_name,
                    wallet_country: wallet.wallet_country || null,
                    solana_address: wallet.wallet_solana_address,
                    solana_balance: solBalance,
                    solana_balance_usd: solBalanceUSD,
                    role: wallet.wallet_auth
                }
            };
        } catch (error) {
            this.logger.error(`Error in getWalletInfo: ${error.message}`);
            throw error;
        }
    }

    async updateWalletAddresses(wallet: ListWallet) {
        try {
            if (!wallet.wallet_solana_address || !wallet.wallet_eth_address) {
                const privateKeyObject = JSON.parse(wallet.wallet_private_key);

                if (!wallet.wallet_solana_address && privateKeyObject?.solana) {
                    const solanaKeypair = Keypair.fromSecretKey(bs58.decode(privateKeyObject.solana));
                    wallet.wallet_solana_address = solanaKeypair.publicKey.toBase58();
                }

                if (!wallet.wallet_eth_address && privateKeyObject?.ethereum) {
                    const ethWallet = new ethers.Wallet(privateKeyObject.ethereum);
                    wallet.wallet_eth_address = ethWallet.address;
                }

                await this.listWalletRepository.save(wallet);
            }
            return wallet;
        } catch (error) {
            console.error('Error updating wallet addresses:', error);
            throw error;
        }
    }

    async findWalletBySolanaAddress(address: string): Promise<ListWallet | null> {
        const wallet = await this.listWalletRepository.findOne({
            where: { wallet_solana_address: address }
        });

        if (wallet) {
            return await this.updateWalletAddresses(wallet);
        }
        return null;
    }

    async findWalletByTelegramId(telegramId: string): Promise<ListWallet | null> {
        // Find user with this telegram ID
        const user = await this.userWalletRepository.findOne({
            where: { uw_telegram_id: telegramId }
        });

        if (!user) {
            return null;
        }

        // Find main wallet linked to this user
        const walletAuth = await this.walletAuthRepository.createQueryBuilder('wa')
            .leftJoinAndSelect('wa.wa_wallet', 'lw')
            .where('wa.wa_user_id = :userId', { userId: user.uw_id })
            .andWhere('wa.wa_type = :type', { type: 'main' })
            .orderBy('wa.wa_id', 'ASC')
            .getOne();

        if (!walletAuth || !walletAuth.wa_wallet) {
            return null;
        }

        return walletAuth.wa_wallet;
    }

    async getPrivateKeys(req): Promise<{ status: number; data?: WalletPrivateKeysDto; message?: string }> {
        try {
            // Lấy wallet_id từ payload JWT
            const { wallet_id } = req.user;

            if (!wallet_id) {
                return {
                    status: 400,
                    message: 'Missing wallet_id in JWT token',
                };
            }

            // Tìm wallet từ wallet_id
            const wallet = await this.listWalletRepository.findOne({
                where: { wallet_id: wallet_id },
            });

            if (!wallet) {
                return {
                    status: 404,
                    message: `Wallet not found`,
                };
            }

            try {
                // Parse private key JSON
                const privateKeyObject = JSON.parse(wallet.wallet_private_key);

                // Lấy private key từ wallet
                const privateKeys: WalletPrivateKeysDto = {
                    sol_private_key: privateKeyObject.solana || '',
                    eth_private_key: privateKeyObject.ethereum || '',
                    bnb_private_key: privateKeyObject.ethereum || '', // BNB sử dụng cùng private key với Ethereum
                };

                return {
                    status: 200,
                    data: privateKeys,
                };
            } catch (error) {
                return {
                    status: 500,
                    message: `Error parsing private keys: ${error.message}`,
                };
            }
        } catch (error) {
            return {
                status: 500,
                message: `Error fetching wallet private keys: ${error.message}`,
            };
        }
    }

    async addWallet(user, addWalletDto: AddWalletDto) {
        try {
            const { uid } = user;
            const { name, type, private_key, nick_name, country } = addWalletDto;

            // Kiểm tra user có tồn tại không
            const userWallet = await this.userWalletRepository.findOne({
                where: { uw_id: uid }
            });

            if (!userWallet) {
                return {
                    status: 404,
                    message: 'User not found',
                };
            }

            let listWallet: ListWallet | undefined;

            if (type === 'other') {
                // Kiểm tra nick_name đã tồn tại chưa khi type là 'other'
                if (!nick_name) {
                    return {
                        status: 400,
                        message: 'Nickname is required for new wallet',
                    };
                }

                // Kiểm tra độ dài tối thiểu của nick_name
                if (nick_name.length < 3) {
                    return {
                        status: 400,
                        message: 'Nickname must be at least 3 characters long',
                    };
                }

                const existingWalletWithNickName = await this.listWalletRepository.findOne({
                    where: { wallet_nick_name: nick_name }
                });

                if (existingWalletWithNickName) {
                    return {
                        status: 400,
                        message: 'Wallet nickname already exists',
                    };
                }

                // Chỉ kiểm tra tên ví có trùng không khi name không phải null/undefined
                if (name) {
                    const existingWalletAuth = await this.walletAuthRepository.findOne({
                        where: {
                            wa_user_id: uid,
                            wa_name: name
                        }
                    });

                    if (existingWalletAuth) {
                        return {
                            status: 400,
                            message: 'Wallet name already exists for this user',
                        };
                    }
                }

                // Tạo ví mới nếu type là 'other'
                // Tạo keypair mới cho đến khi không có xung đột
                let retryCount = 0;
                const maxRetries = 3;

                while (retryCount < maxRetries) {
                    try {
                        const solanaKeypair = Keypair.generate();
                        const solanaPublicKey = solanaKeypair.publicKey.toBase58();
                        const solanaPrivateKey = bs58.encode(solanaKeypair.secretKey);

                        // Tạo Ethereum private key từ Solana private key
                        const ethPrivateKeyBytes = solanaKeypair.secretKey.slice(0, 32);
                        const ethPrivateKey = '0x' + Buffer.from(ethPrivateKeyBytes).toString('hex');
                        const ethWallet = new ethers.Wallet(ethPrivateKey);

                        // Kiểm tra địa chỉ đã tồn tại chưa
                        const existingWallet = await this.listWalletRepository.findOne({
                            where: { wallet_solana_address: solanaPublicKey }
                        });

                        if (existingWallet) {
                            retryCount++;
                            continue; // Tạo lại keypair mới
                        }

                        // Tạo ví mới
                        listWallet = this.listWalletRepository.create({
                            wallet_private_key: JSON.stringify({
                                solana: solanaPrivateKey,
                                ethereum: ethPrivateKey
                            }),
                            wallet_solana_address: solanaPublicKey,
                            wallet_eth_address: ethWallet.address,
                            wallet_status: true,
                            wallet_auth: 'member',
                            wallet_nick_name: nick_name,
                            wallet_country: country || undefined
                        });

                        // Lưu ví vào database
                        listWallet = await this.listWalletRepository.save(listWallet);
                        break; // Thoát khỏi vòng lặp nếu thành công
                    } catch (error) {
                        if (error.message.includes('duplicate key') && retryCount < maxRetries - 1) {
                            retryCount++;
                            this.logger.warn(`Duplicate key detected, retrying (${retryCount}/${maxRetries})`);
                        } else {
                            throw error; // Ném lỗi nếu đã thử lại đủ số lần
                        }
                    }
                }

                if (listWallet === undefined) {
                    throw new Error(`Failed to create wallet after ${maxRetries} attempts`);
                }
            } else if (type === 'import') {
                // Kiểm tra private_key có được cung cấp không
                if (!private_key) {
                    return {
                        status: 400,
                        message: 'Private key is required for import',
                    };
                }

                // Kiểm tra private_key có hợp lệ không
                try {
                    const decodedKey = bs58.decode(private_key);
                    Keypair.fromSecretKey(decodedKey);
                } catch (error) {
                    return {
                        status: 400,
                        message: 'Invalid Solana private key',
                    };
                }

                // Kiểm tra private_key đã tồn tại trong list_wallets chưa
                const existingWallet = await this.listWalletRepository.createQueryBuilder('lw')
                    .where(`lw.wallet_private_key::jsonb->>'solana' = :privateKey`, { privateKey: private_key })
                    .getOne();

                if (existingWallet) {
                    // Kiểm tra xem ví đã tồn tại này đã được liên kết với user hiện tại chưa
                    const existingWalletAuth = await this.walletAuthRepository.findOne({
                        where: {
                            wa_user_id: uid,
                            wa_wallet_id: existingWallet.wallet_id
                        }
                    });

                    if (existingWalletAuth) {
                        return {
                            status: 400,
                            message: 'This wallet is already linked to your account',
                        };
                    }

                    // Nếu ví đã tồn tại nhưng chưa liên kết với user, sử dụng ví đó
                    listWallet = existingWallet;
                } else {
                    // Nếu ví chưa tồn tại, kiểm tra nick_name
                    if (!nick_name) {
                        return {
                            status: 400,
                            message: 'Nickname is required for new imported wallet',
                        };
                    }

                    // Kiểm tra nick_name đã tồn tại chưa
                    const existingWalletWithNickName = await this.listWalletRepository.findOne({
                        where: { wallet_nick_name: nick_name }
                    });

                    if (existingWalletWithNickName) {
                        return {
                            status: 400,
                            message: 'Wallet nickname already exists',
                        };
                    }

                    // Tạo ví mới
                    try {
                        const solanaKeypair = Keypair.fromSecretKey(bs58.decode(private_key));
                        const solanaPublicKey = solanaKeypair.publicKey.toBase58();

                        // Tạo Ethereum private key từ Solana private key
                        const ethPrivateKeyBytes = solanaKeypair.secretKey.slice(0, 32);
                        const ethPrivateKey = '0x' + Buffer.from(ethPrivateKeyBytes).toString('hex');
                        const ethWallet = new ethers.Wallet(ethPrivateKey);

                        // Tạo ví mới
                        listWallet = this.listWalletRepository.create({
                            wallet_private_key: JSON.stringify({
                                solana: private_key,
                                ethereum: ethPrivateKey
                            }),
                            wallet_solana_address: solanaPublicKey,
                            wallet_eth_address: ethWallet.address,
                            wallet_status: true,
                            wallet_auth: 'member',
                            wallet_nick_name: nick_name,
                            wallet_country: country || undefined
                        });
                        await this.listWalletRepository.save(listWallet);
                    } catch (error) {
                        return {
                            status: 400,
                            message: `Error creating wallet: ${error.message}`,
                        };
                    }
                }
            } else {
                return {
                    status: 400,
                    message: 'Invalid wallet type',
                };
            }

            // Trước khi tạo wallet_auth, kiểm tra xem liên kết đã tồn tại chưa
            const existingWalletAuth = await this.walletAuthRepository.findOne({
                where: {
                    wa_user_id: userWallet.uw_id,
                    wa_wallet_id: listWallet.wallet_id
                }
            });

            if (existingWalletAuth) {
                return {
                    status: 400,
                    message: 'This wallet is already linked to your account'
                };
            }

            // Tạo liên kết wallet_auth với tên có thể là null
            try {
                // Sử dụng phương thức mới để tạo wallet_auth
                await this.createWalletAuth(
                    userWallet.uw_id,
                    listWallet.wallet_id,
                    type,
                    name || null
                );
            } catch (error) {
                if (error.message.includes('already linked')) {
                    return {
                        status: 400,
                        message: error.message
                    };
                }
                return {
                    status: 500,
                    message: `Error adding wallet: ${error.message}`
                };
            }

            // Cập nhật địa chỉ ví nếu cần
            await this.updateWalletAddresses(listWallet);

            return {
                status: 200,
                message: 'Wallet added successfully',
                data: {
                    wallet_id: listWallet.wallet_id,
                    solana_address: listWallet.wallet_solana_address,
                    eth_address: listWallet.wallet_eth_address,
                    wallet_type: type,
                    wallet_name: name || null,
                    wallet_nick_name: listWallet.wallet_nick_name,
                    wallet_country: listWallet.wallet_country
                }
            };
        } catch (error) {
            this.logger.error(`Error adding wallet: ${error.message}`, error.stack);
            return {
                status: 500,
                message: `Error adding wallet: ${error.message}`,
            };
        }
    }

    private async createWalletAuth(
        userId: number,
        walletId: number,
        type: string,
        name: string | null
    ): Promise<number> {
        try {
            // Trước khi insert, kiểm tra xem có bản ghi nào cho cặp user và wallet này chưa
            const existingCheck = await this.walletAuthRepository.query(
                `SELECT COUNT(*) as count FROM wallet_auth WHERE wa_user_id = $1 AND wa_wallet_id = $2`,
                [userId, walletId]
            );

            if (existingCheck[0].count > 0) {
                throw new Error('This wallet is already linked to your account');
            }

            // Dùng SQL thuần để chèn với cú pháp ON CONFLICT DO NOTHING để tránh lỗi
            const result = await this.walletAuthRepository.query(`
                INSERT INTO wallet_auth (wa_user_id, wa_wallet_id, wa_type, wa_name)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT DO NOTHING
                RETURNING wa_id
            `, [userId, walletId, type, name]);

            if (result && result.length > 0) {
                return result[0].wa_id;
            } else {
                // Nếu không insert được, có thể đã có conflict. Thử lấy record đã tồn tại
                const existing = await this.walletAuthRepository.findOne({
                    where: {
                        wa_user_id: userId,
                        wa_wallet_id: walletId
                    }
                });

                if (existing) {
                    return existing.wa_id;
                }
            }

            throw new Error('Failed to create or get wallet_auth record');
        } catch (error) {
            this.logger.error(`Error creating wallet auth: ${error.message}`, error.stack);

            // Kiểm tra lỗi duplicate
            if (error.message.includes('duplicate key') || error.message.includes('already linked')) {
                throw new Error('This wallet is already linked to your account');
            }
            throw error;
        }
    }

    async updateWallet(user, updateWalletDto: { wallet_id: number; name: string; nick_name?: string; country?: string }) {
        try {
            const { uid } = user;
            const { wallet_id, name, nick_name, country } = updateWalletDto;

            // Kiểm tra user có tồn tại không
            const userWallet = await this.userWalletRepository.findOne({
                where: { uw_id: uid }
            });

            if (!userWallet) {
                return {
                    status: 404,
                    message: 'User not found',
                };
            }

            // Kiểm tra tên ví này đã được sử dụng cho ví khác chưa
            const existingWalletWithName = await this.walletAuthRepository.findOne({
                where: {
                    wa_user_id: uid,
                    wa_name: name
                }
            });

            if (existingWalletWithName && existingWalletWithName.wa_wallet_id !== wallet_id) {
                return {
                    status: 400,
                    message: 'Wallet name already exists for this user',
                };
            }

            // Kiểm tra liên kết giữa user và wallet có tồn tại không
            const walletAuth = await this.walletAuthRepository.findOne({
                where: {
                    wa_user_id: uid,
                    wa_wallet_id: wallet_id
                },
                relations: ['wa_wallet']
            });

            if (!walletAuth) {
                return {
                    status: 404,
                    message: 'Wallet not linked to this user',
                };
            }

            // Nếu có nick_name được truyền vào, kiểm tra quyền cập nhật
            if (nick_name) {
                // Kiểm tra xem ví này có phải là ví main của user nào không
                const mainWalletAuth = await this.walletAuthRepository.findOne({
                    where: {
                        wa_wallet_id: wallet_id,
                        wa_type: 'main'
                    },
                    relations: ['wa_user']
                });

                if (mainWalletAuth) {
                    // Nếu là ví main, chỉ cho phép chủ sở hữu cập nhật
                    if (mainWalletAuth.wa_user.uw_telegram_id !== userWallet.uw_telegram_id) {
                        return {
                            status: 403,
                            message: 'Only the main wallet owner can update its nickname',
                        };
                    }
                }

                // Kiểm tra nick_name đã tồn tại chưa
                const existingWalletWithNickName = await this.listWalletRepository.findOne({
                    where: { wallet_nick_name: nick_name }
                });

                if (existingWalletWithNickName && existingWalletWithNickName.wallet_id !== wallet_id) {
                    return {
                        status: 400,
                        message: 'Wallet nickname already exists',
                    };
                }

                // Cập nhật nick_name
                walletAuth.wa_wallet.wallet_nick_name = nick_name;
            }

            // Cập nhật country nếu được truyền vào
            if (country !== undefined) {
                walletAuth.wa_wallet.wallet_country = country;
            }

            // Lưu thay đổi vào list_wallets
            if (nick_name || country !== undefined) {
                await this.listWalletRepository.save(walletAuth.wa_wallet);
            }

            // Cập nhật tên ví
            walletAuth.wa_name = name;
            await this.walletAuthRepository.save(walletAuth);

            // Trả về thông tin ví đã cập nhật
            return {
                status: 200,
                message: 'Wallet updated successfully',
                data: {
                    wallet_id: walletAuth.wa_wallet_id,
                    wallet_type: walletAuth.wa_type,
                    wallet_name: walletAuth.wa_name,
                    wallet_nick_name: walletAuth.wa_wallet.wallet_nick_name,
                    wallet_country: walletAuth.wa_wallet.wallet_country,
                    solana_address: walletAuth.wa_wallet?.wallet_solana_address || null,
                    eth_address: walletAuth.wa_wallet?.wallet_eth_address || null
                }
            };
        } catch (error) {
            this.logger.error(`Error updating wallet: ${error.message}`, error.stack);
            return {
                status: 500,
                message: `Error updating wallet: ${error.message}`,
            };
        }
    }

    async deleteWallet(user, wallet_id: number) {
        try {
            const { uid, wallet_id: currentWalletId } = user;

            // Kiểm tra xem wallet có đang được sử dụng không
            if (currentWalletId === wallet_id) {
                return {
                    status: 400,
                    message: 'Cannot delete wallet that is currently in use',
                };
            }

            // Kiểm tra user có tồn tại không
            const userWallet = await this.userWalletRepository.findOne({
                where: { uw_id: uid }
            });

            if (!userWallet) {
                return {
                    status: 404,
                    message: 'User not found',
                };
            }

            // Kiểm tra liên kết giữa user và wallet có tồn tại không
            const walletAuth = await this.walletAuthRepository.findOne({
                where: {
                    wa_user_id: uid,
                    wa_wallet_id: wallet_id
                },
                relations: ['wa_wallet']
            });

            if (!walletAuth) {
                return {
                    status: 404,
                    message: 'Wallet not linked to this user',
                };
            }

            // Không cho phép xóa ví chính (main)
            if (walletAuth.wa_type === 'main') {
                return {
                    status: 400,
                    message: 'Cannot delete main wallet',
                };
            }

            // Lưu thông tin ví để trả về
            const walletInfo = {
                wallet_id: walletAuth.wa_wallet_id,
                wallet_type: walletAuth.wa_type,
                wallet_name: walletAuth.wa_name,
                solana_address: walletAuth.wa_wallet?.wallet_solana_address || null,
                eth_address: walletAuth.wa_wallet?.wallet_eth_address || null
            };

            // Xóa liên kết trong wallet_auth
            await this.walletAuthRepository.remove(walletAuth);

            return {
                status: 200,
                message: 'Wallet unlinked successfully',
                data: walletInfo
            };
        } catch (error) {
            this.logger.error(`Error deleting wallet: ${error.message}`, error.stack);
            return {
                status: 500,
                message: `Error deleting wallet: ${error.message}`,
            };
        }
    }

    async getMyWallets(user) {
        try {
            const { uid } = user;

            // Kiểm tra user có tồn tại không
            const userWallet = await this.userWalletRepository.findOne({
                where: { uw_id: uid }
            });

            if (!userWallet) {
                return {
                    status: 404,
                    message: 'User not found',
                    data: []
                };
            }

            // Tìm tất cả các ví được liên kết với user
            const walletAuths = await this.walletAuthRepository.createQueryBuilder('wa')
                .leftJoinAndSelect('wa.wa_wallet', 'lw')
                .where('wa.wa_user_id = :userId', { userId: uid })
                .orderBy('wa.wa_type', 'ASC') // Sắp xếp 'main' lên đầu
                .addOrderBy('wa.wa_id', 'ASC')
                .getMany();

            if (!walletAuths || walletAuths.length === 0) {
                return {
                    status: 200,
                    message: 'No wallets found for this user',
                    data: []
                };
            }

            // Lấy giá SOL từ cache
            const solPriceInfo = await this.solanaService.getTokenPricesInRealTime(['So11111111111111111111111111111111111111112']);
            const solPrice = solPriceInfo.get('So11111111111111111111111111111111111111112');

            // Chuyển đổi dữ liệu sang định dạng phản hồi
            const walletsList = await Promise.all(walletAuths.map(async auth => {
                // Lấy số dư SOL của ví
                const solBalance = await this.solanaService.getBalance(auth.wa_wallet?.wallet_solana_address);
                // Tính số dư USD
                const solBalanceUSD = solBalance * (solPrice?.priceUSD || 0);

                return {
                    wallet_id: auth.wa_wallet_id,
                    wallet_type: auth.wa_type,
                    wallet_name: auth.wa_name,
                    wallet_nick_name: auth.wa_wallet?.wallet_nick_name || null,
                    wallet_country: auth.wa_wallet?.wallet_country || null,
                    solana_address: auth.wa_wallet?.wallet_solana_address || null,
                    eth_address: auth.wa_wallet?.wallet_eth_address || null,
                    wallet_auth: auth.wa_wallet?.wallet_auth || 'member',
                    solana_balance: solBalance,
                    solana_balance_usd: solBalanceUSD
                };
            }));

            return {
                status: 200,
                message: 'Wallets retrieved successfully',
                data: walletsList
            };
        } catch (error) {
            this.logger.error(`Error getting user wallets: ${error.message}`, error.stack);
            return {
                status: 500,
                message: `Error getting user wallets: ${error.message}`,
                data: []
            };
        }
    }

    async useWallet(user, wallet_id: number) {
        try {
            const { uid } = user;

            // Kiểm tra user có tồn tại không
            const userWallet = await this.userWalletRepository.findOne({
                where: { uw_id: uid }
            });

            if (!userWallet) {
                return {
                    status: 404,
                    message: 'User not found',
                };
            }

            // Kiểm tra liên kết giữa user và wallet có tồn tại không
            const walletAuth = await this.walletAuthRepository.findOne({
                where: {
                    wa_user_id: uid,
                    wa_wallet_id: wallet_id
                },
                relations: ['wa_wallet']
            });

            if (!walletAuth || !walletAuth.wa_wallet) {
                return {
                    status: 404,
                    message: 'Wallet not linked to this user',
                };
            }

            // Kiểm tra trạng thái của ví
            if (!walletAuth.wa_wallet.wallet_status) {
                return {
                    status: 400,
                    message: 'Wallet is disabled',
                };
            }

            // Lấy thông tin JWT secret và expiration từ config
            const jwtSecret = this.configService.get<string>('JWT_SECRET');
            if (!jwtSecret) {
                throw new Error('JWT_SECRET is missing in environment variables');
            }

            const jwtExpiration = this.configService.get<string>('JWT_EXPIRATION', '86400');
            const expiresIn = parseInt(jwtExpiration, 10);

            // Tạo payload cho JWT token
            const payload = {
                uid: uid,
                wallet_id: wallet_id,
                sol_public_key: walletAuth.wa_wallet.wallet_solana_address,
                eth_public_key: walletAuth.wa_wallet.wallet_eth_address,
            };

            // Định nghĩa options
            const signOptions: jwt.SignOptions = {
                expiresIn,
                algorithm: 'HS256',
            };

            // Tạo token mới
            const token = jwt.sign(payload, jwtSecret, signOptions);

            return {
                status: 200,
                message: 'Wallet switched successfully',
                token: token
            };
        } catch (error) {
            this.logger.error(`Error switching wallet: ${error.message}`, error.stack);
            return {
                status: 500,
                message: `Error switching wallet: ${error.message}`,
            };
        }
    }

    async getMyTokens(user) {
        try {
            const { uid, wallet_id } = user;

            // Kiểm tra user có tồn tại không
            const userWallet = await this.userWalletRepository.findOne({
                where: { uw_id: uid }
            });

            if (!userWallet) {
                return {
                    status: 404,
                    message: 'User not found',
                    data: []
                };
            }

            // Kiểm tra wallet có tồn tại không
            const wallet = await this.listWalletRepository.findOne({
                where: { wallet_id: wallet_id }
            });

            if (!wallet) {
                return {
                    status: 404,
                    message: 'Wallet not found',
                    data: []
                };
            }

            // Kiểm tra xem ví có được liên kết với user không
            const walletAuth = await this.walletAuthRepository.findOne({
                where: {
                    wa_user_id: uid,
                    wa_wallet_id: wallet_id
                }
            });

            if (!walletAuth) {
                return {
                    status: 401,
                    message: 'Wallet not linked to this user',
                    data: []
                };
            }

            // Lấy danh sách token của ví
            const tokens = await this.solanaListTokenRepository.find({
                where: { slt_wallet_id: wallet_id },
                order: { slt_created_at: 'DESC' }
            });

            // Chuyển đổi dữ liệu sang định dạng phản hồi
            const tokensList = tokens.map(token => ({
                token_id: token.slt_id,
                name: token.slt_name,
                symbol: token.slt_symbol,
                address: token.slt_address,
                decimals: token.slt_decimals,
                logo_url: token.slt_logo_url,
                description: token.slt_description,
                twitter: token.slt_twitter,
                telegram: token.slt_telegram,
                website: token.slt_website,
                transaction_hash: token.slt_transaction_hash,
                metadata_uri: token.slt_metadata_uri,
                initial_liquidity: token.slt_initial_liquidity,
                is_verified: token.slt_is_verified,
                created_at: token.slt_created_at,
                updated_at: token.slt_updated_at
            }));

            return {
                status: 200,
                message: 'Tokens retrieved successfully',
                data: tokensList
            };
        } catch (error) {
            this.logger.error(`Error getting user tokens: ${error.message}`, error.stack);
            return {
                status: 500,
                message: `Error getting user tokens: ${error.message}`,
                data: []
            };
        }
    }

    async createToken(user: any, createTokenDto: CreateTokenDto, file: any) {
        try {
            const { wallet_id } = user;
            this.logger.log(`Creating token with wallet_id: ${wallet_id}`);

            const wallet = await this.listWalletRepository.findOne({
                where: { wallet_id: wallet_id }
            });

            if (!wallet) {
                this.logger.error(`Wallet not found for wallet_id: ${wallet_id}`);
                return {
                    status: 404,
                    message: 'Wallet not found'
                };
            }

            // Validate public key
            if (!wallet.wallet_solana_address) {
                return {
                    status: 400,
                    message: 'Invalid wallet: Missing Solana address'
                };
            }

            // Validate required fields
            if (!createTokenDto.name || !createTokenDto.symbol || !file) {
                return {
                    status: 400,
                    message: 'Missing required fields: name, symbol and image are required'
                };
            }

            const tokenData = {
                name: createTokenDto.name,
                symbol: createTokenDto.symbol,
                description: createTokenDto.description || `${createTokenDto.name} token on Solana`,
                twitter: createTokenDto.twitter || undefined,
                telegram: createTokenDto.telegram || undefined,
                website: createTokenDto.website || undefined,
                showName: createTokenDto.showName !== undefined ? createTokenDto.showName : true,
                amount: createTokenDto.amount ? Number(createTokenDto.amount) : 0
            };

            const privateKeyObject = JSON.parse(wallet.wallet_private_key);
            if (!privateKeyObject.solana) {
                return {
                    status: 400,
                    message: 'Invalid wallet: Missing Solana private key'
                };
            }

            // Tạo token
            const result = await this.solanaService.createToken(
                privateKeyObject.solana,
                wallet.wallet_solana_address,
                tokenData,
                file,
                wallet_id
            );

            // Nếu tạo token thành công và có category_list, tạo liên kết với các category
            if (result.status === 200 && result.data && createTokenDto.category_list && createTokenDto.category_list.length > 0) {
                try {
                    // Lấy token vừa tạo
                    const token = await this.solanaListTokenRepository.findOne({
                        where: { slt_transaction_hash: result.data.transaction }
                    });

                    if (token) {
                        // Tạo liên kết với các category
                        for (const categoryId of createTokenDto.category_list) {
                            // Kiểm tra category có tồn tại không
                            const category = await this.solanaListCategoriesTokenRepository.findOne({
                                where: { slct_id: categoryId }
                            });

                            if (category) {
                                // Tạo liên kết
                                const joinCategory = this.solanaTokenJoinCategoryRepository.create({
                                    stjc_token_id: token.slt_id,
                                    stjc_category_id: categoryId,
                                    stjc_status: JoinCategoryStatus.ON
                                });
                                await this.solanaTokenJoinCategoryRepository.save(joinCategory);
                            }
                        }
                    }
                } catch (error) {
                    this.logger.error(`Error creating category links: ${error.message}`, error.stack);
                    // Không trả về lỗi vì token đã được tạo thành công
                }
            }

            return result;
        } catch (error) {
            this.logger.error(`Error in createToken: ${error.message}`, error.stack);
            return {
                status: 500,
                message: error.message || 'Internal server error'
            };
        }
    }

    async getCategories(): Promise<GetCategoriesResponseDto> {
        try {
            const categories = await this.solanaListCategoriesTokenRepository.findActiveCategories();

            const categoriesList = categories.map(category => ({
                id: category.slct_id,
                name: category.slct_name,
                slug: category.slct_slug,
                prioritize: category.slct_prioritize,
                status: category.sltc_status
            }));

            return {
                status: 200,
                message: 'Categories retrieved successfully',
                data: categoriesList
            };
        } catch (error) {
            this.logger.error(`Error getting categories: ${error.message}`, error.stack);
            return {
                status: 500,
                message: `Error getting categories: ${error.message}`,
                data: []
            };
        }
    }

    async getWalletBalance(walletAddress: string) {
        try {
            const wallet = await this.listWalletRepository.findOne({
                where: { wallet_solana_address: walletAddress }
            });
            if (!wallet) {
                return {
                    status: 404,
                    message: 'Wallet not found',
                    data: null
                };
            }
            const solBalance = await this.solanaService.getBalance(walletAddress);
            const solBalanceUSD = await this.solanaService.getBalanceInUSD(walletAddress);

            return {
                status: 200,
                message: 'Wallet balance retrieved successfully',
                data: {
                    sol_balance: solBalance,
                    sol_balance_usd: solBalanceUSD
                }
            };
        } catch (error) {
            this.logger.error(`Error getting wallet balance: ${error.message}`, error.stack);
            return {
                status: 500,
                message: `Error getting wallet balance: ${error.message}`,
                data: null
            };
        }
    }

    async getListBuyTokens(user: any) {
        try {
            const { wallet_id } = user;
            const wallet = await this.listWalletRepository.findOne({
                where: { wallet_id }
            });

            if (!wallet) {
                return {
                    status: 404,
                    message: 'Wallet not found'
                };
            }

            const walletAddress = wallet.wallet_solana_address;
            const tokenAccounts = await this.solanaService.getTokenAccounts(walletAddress);

            const tokens = await Promise.all(tokenAccounts.map(async (account) => {
                // Try to get token info from Redis cache first
                const cacheKey = `token:${account.mint}`;
                let tokenInfo = await this.redisCacheService.get(cacheKey);

                if (!tokenInfo) {
                    // If not in cache, get from database
                    tokenInfo = await this.solanaListTokenRepository.findOne({
                        where: { slt_address: account.mint }
                    });

                    if (tokenInfo) {
                        // Cache the token info for 1 hour
                        await this.redisCacheService.set(cacheKey, tokenInfo, 3600);
                    }
                }

                // If still no token info, try to get from Solana network
                if (!tokenInfo) {
                    try {
                        const tokenData = await this.solanaService.getTokenInfo(account.mint);
                        tokenInfo = this.solanaListTokenRepository.create({
                            slt_address: account.mint,
                            slt_name: tokenData.name || '',
                            slt_symbol: tokenData.symbol || '',
                            slt_decimals: tokenData.decimals || 0,
                            slt_logo_url: tokenData.logoURI || '',
                            slt_is_verified: tokenData.verified || false
                        });
                        await this.solanaListTokenRepository.save(tokenInfo);
                        // Cache the new token info
                        await this.redisCacheService.set(cacheKey, tokenInfo, 3600);
                    } catch (error) {
                        this.logger.error(`Error fetching token info for ${account.mint}: ${error.message}`);
                    }
                }

                // Get token price
                const tokenPrice = await this.solanaService.getTokenPricesInRealTime([account.mint]);
                const tokenBalanceUSD = account.amount * (tokenPrice?.get(account.mint)?.priceUSD || 0);

                return {
                    token_address: account.mint,
                    token_name: tokenInfo?.slt_name || '',
                    token_symbol: tokenInfo?.slt_symbol || '',
                    token_logo_url: tokenInfo?.slt_logo_url || '',
                    token_decimals: tokenInfo?.slt_decimals || 0,
                    token_balance: account.amount,
                    token_balance_usd: tokenBalanceUSD,
                    token_price_usd: tokenPrice?.get(account.mint)?.priceUSD || 0,
                    token_price_sol: tokenPrice?.get(account.mint)?.priceSOL || 0,
                    is_verified: tokenInfo?.slt_is_verified || false
                };
            }));

            return {
                status: 200,
                message: 'Token list retrieved successfully',
                data: {
                    wallet_address: walletAddress,
                    tokens: tokens
                }
            };
        } catch (error) {
            this.logger.error(`Error getting list buy tokens: ${error.message}`, error.stack);
            return {
                status: 500,
                message: `Error getting list buy tokens: ${error.message}`,
                data: null
            };
        }
    }

    async getWalletInfoById(idOrPrivateKey: string | number) {
        try {
            let wallet: ListWallet | null = null;

            // Kiểm tra xem input có phải là private key của Solana không
            if (typeof idOrPrivateKey === 'string') {
                try {
                    // Thử decode private key để kiểm tra định dạng
                    const decodedKey = bs58.decode(idOrPrivateKey);
                    if (decodedKey.length === 64) { // Solana private key length
                        // Tìm ví với private key này
                        wallet = await this.listWalletRepository.createQueryBuilder('lw')
                            .where(`lw.wallet_private_key::jsonb->>'solana' = :privateKey`, { privateKey: idOrPrivateKey })
                            .getOne();
                    }
                } catch (error) {
                    // Nếu không decode được, có thể là wallet_id dạng string
                    const numericId = parseInt(idOrPrivateKey);
                    if (!isNaN(numericId)) {
                        wallet = await this.listWalletRepository.findOne({
                            where: { wallet_id: numericId }
                        });
                    }
                }
            } else {
                // Nếu là number, tìm theo wallet_id
                wallet = await this.listWalletRepository.findOne({
                    where: { wallet_id: idOrPrivateKey }
                });
            }

            if (!wallet) {
                return {
                    status: 404,
                    message: 'Wallet not found',
                    data: null
                };
            }

            // Tìm wallet_name từ wallet_auth (lấy bản ghi đầu tiên nếu có nhiều)
            const walletAuth = await this.walletAuthRepository.findOne({
                where: { wa_wallet_id: wallet.wallet_id }
            });

            return {
                status: 200,
                message: 'Wallet info retrieved successfully',
                data: {
                    wallet_id: wallet.wallet_id,
                    wallet_name: walletAuth?.wa_name || null,
                    wallet_nick_name: wallet.wallet_nick_name,
                    wallet_country: wallet.wallet_country || null,
                    solana_address: wallet.wallet_solana_address,
                    role: wallet.wallet_auth
                }
            };
        } catch (error) {
            this.logger.error(`Error getting wallet info: ${error.message}`, error.stack);
            return {
                status: 500,
                message: `Error getting wallet info: ${error.message}`,
                data: null
            };
        }
    }
}
