import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, IsNull, Not, Raw, Brackets } from 'typeorm';
import { SolanaListToken } from './entities/solana-list-token.entity';
import { SolanaWishlistToken } from './entities/solana-wishlist-token.entity';
import { SolanaTokenDto, SolanaTokensResponseDto, SolanaTokenQueryDto } from './dto/solana-token.dto';
import { SolanaService } from './solana.service';
import { WishlistStatus } from './entities/solana-wishlist-token.entity';
import { TokenProgram } from './entities/solana-list-token.entity';
import { BirdeyeService } from '../on-chain/birdeye.service';
import { DeepPartial } from 'typeorm';
import { CacheService } from '../cache/cache.service';
import { ChatsService } from '../chats/chats.service';

@Injectable()
export class SolanaTokensService {
    private readonly logger = new Logger(SolanaTokensService.name);

    constructor(
        @InjectRepository(SolanaListToken)
        private solanaTokenRepository: Repository<SolanaListToken>,
        private solanaService: SolanaService,
        @InjectRepository(SolanaWishlistToken)
        private wishlistTokenRepository: Repository<SolanaWishlistToken>,
        private birdeyeService: BirdeyeService,
        private cacheService: CacheService,
        private chatsService: ChatsService
    ) { }

    async findAll(query: SolanaTokenQueryDto): Promise<{ status: number; data?: any; message?: string }> {
        try {
            const page = query.page || 1;
            const limit = query.limit || 10;
            const skip = (page - 1) * limit;

            // Chuyển đổi tham số random từ chuỗi sang boolean
            const random = query.random === true || String(query.random) === 'true';

            // Điều kiện cơ bản: có đầy đủ name, symbol và logo_url
            let whereCondition: any = {
                slt_name: Raw(alias => `${alias} IS NOT NULL AND TRIM(${alias}) != ''`),
                slt_symbol: Raw(alias => `${alias} IS NOT NULL AND TRIM(${alias}) != ''`),
                slt_logo_url: Raw(alias => `${alias} IS NOT NULL AND TRIM(${alias}) != ''`),
            };

            // Thêm điều kiện tìm kiếm nếu có
            if (query.search) {
                whereCondition = [
                    { ...whereCondition, slt_name: Like(`%${query.search}%`) },
                    { ...whereCondition, slt_symbol: Like(`%${query.search}%`) },
                    { ...whereCondition, slt_address: Like(`%${query.search}%`) },
                ];
            }

            // Thêm điều kiện lọc theo verified nếu có
            if (query.verified !== undefined) {
                if (Array.isArray(whereCondition)) {
                    whereCondition = whereCondition.map(condition => ({
                        ...condition,
                        slt_is_verified: query.verified,
                    }));
                } else {
                    whereCondition.slt_is_verified = query.verified;
                }
            }

            // Xác định cách sắp xếp
            let queryBuilder = this.solanaTokenRepository.createQueryBuilder('token');

            // Áp dụng các điều kiện lọc
            if (Array.isArray(whereCondition)) {
                // Xử lý điều kiện OR
                queryBuilder.where(new Brackets(qb => {
                    whereCondition.forEach((condition, index) => {
                        if (index === 0) {
                            qb.where(condition);
                        } else {
                            qb.orWhere(condition);
                        }
                    });
                }));
            } else {
                // Xử lý điều kiện AND
                queryBuilder.where(whereCondition);
            }

            // Áp dụng sắp xếp
            if (random) {
                // Đếm tổng số token thỏa mãn điều kiện
                const total = await queryBuilder.getCount();

                // Sử dụng timestamp hiện tại làm seed cho random
                const timestamp = Date.now();
                const randomSeed = timestamp % 1000000;

                // Tính toán offset ngẫu nhiên dựa trên timestamp
                const maxOffset = Math.max(0, total - limit);
                const randomOffset = Math.floor((randomSeed / 1000000) * maxOffset);

                // Áp dụng offset ngẫu nhiên và limit
                queryBuilder.skip(randomOffset).take(limit);

                // Thực hiện truy vấn
                const tokens = await queryBuilder.getMany();

                return {
                    status: 200,
                    data: {
                        tokens: tokens.map(this.mapToDto),
                        total,
                        page: 1,
                        limit,
                    }
                };
            } else {
                queryBuilder.orderBy('token.slt_market_cap', 'DESC')
                    .addOrderBy('token.slt_name', 'ASC');

                // Áp dụng phân trang cho trường hợp không random
                queryBuilder.skip(skip).take(limit);

                // Thực hiện truy vấn
                const [tokens, total] = await queryBuilder.getManyAndCount();

                return {
                    status: 200,
                    data: {
                        tokens: tokens.map(this.mapToDto),
                        total,
                        page,
                        limit,
                    }
                };
            }
        } catch (error) {
            return {
                status: 500,
                message: `Error fetching tokens: ${error.message}`
            };
        }
    }

    async findOne(id: number): Promise<{ status: number; data?: SolanaTokenDto; message?: string }> {
        try {
            const token = await this.solanaTokenRepository.findOne({
                where: { slt_id: id },
            });

            if (!token) {
                return {
                    status: 404,
                    message: `Token with ID ${id} not found`
                };
            }

            return {
                status: 200,
                data: this.mapToDto(token)
            };
        } catch (error) {
            return {
                status: 500,
                message: `Error fetching token: ${error.message}`
            };
        }
    }

    async findByAddress(address: string): Promise<{ status: number; data?: SolanaTokenDto; message?: string }> {
        try {
            // Gọi getTokenInfo để lấy thông tin token
            const tokenInfo = await this.getTokenInfo(address);
            
            if (tokenInfo.status !== 200) {
                return {
                    status: tokenInfo.status,
                    message: tokenInfo.message
                };
            }

            return {
                status: 200,
                data: tokenInfo.data
            };
        } catch (error) {
            this.logger.error(`Error in findByAddress: ${error.message}`, error.stack);
            return {
                status: 500,
                message: `Error fetching token: ${error.message}`
            };
        }
    }

    async updateTradingviewSymbol(address: string, tradingviewSymbol: string): Promise<{ status: number; message: string; data?: any }> {
        try {
            // Tìm token theo address
            const token = await this.solanaTokenRepository.findOne({
                where: { slt_address: address }
            });

            if (!token) {
                return {
                    status: 404,
                    message: `Token with address ${address} not found`
                };
            }

            // Cập nhật tradingview symbol
            await this.solanaTokenRepository.update(
                { slt_id: token.slt_id },
                { slt_tradingview_symbol: tradingviewSymbol }
            );

            return {
                status: 200,
                message: 'TradingView symbol updated successfully',
                data: {
                    address: token.slt_address,
                    name: token.slt_name,
                    symbol: token.slt_symbol,
                    tradingviewSymbol
                }
            };
        } catch (error) {
            return {
                status: 500,
                message: `Error updating TradingView symbol: ${error.message}`
            };
        }
    }

    private mapToDto(token: SolanaListToken): SolanaTokenDto {
        return {
            id: token.slt_id,
            name: token.slt_name,
            symbol: token.slt_symbol,
            address: token.slt_address,
            decimals: token.slt_decimals,
            logoUrl: token.slt_logo_url || '',
            coingeckoId: token.slt_coingecko_id,
            tradingviewSymbol: token.slt_tradingview_symbol,
            isVerified: token.slt_is_verified,
            marketCap: token.slt_market_cap,
            volume24h: 0,
            liquidity: 0,
            holders: 0,
            twitter: token.slt_twitter,
            telegram: token.slt_telegram,
            website: token.slt_website,
            price: token.slt_price
        };
    }

    private shuffleArray<T>(array: T[]): T[] {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    private shuffleArrayThoroughly<T>(array: T[]): T[] {
        // Trộn ngẫu nhiên nhiều lần để đảm bảo tính ngẫu nhiên
        for (let round = 0; round < 3; round++) {
            // Fisher-Yates shuffle algorithm
            for (let i = array.length - 1; i > 0; i--) {
                // Tạo số ngẫu nhiên mới mỗi lần
                const j = Math.floor(Math.random() * (i + 1));
                // Swap
                [array[i], array[j]] = [array[j], array[i]];
            }
        }
        return array;
    }

    async searchTokens(params: {
        search: string;
        page?: number;
        limit?: number;
        verified?: boolean;
    }): Promise<{ status: number; data?: any; message?: string }> {
        const startTime = Date.now();
        try {
            const { search, page = 1, limit = 10, verified } = params;
            const skip = (page - 1) * limit;

            if (!search || search.trim() === '') {
                return {
                    status: 400,
                    message: 'Search query is required'
                };
            }

            // Tạo query builder
            let queryBuilder = this.solanaTokenRepository.createQueryBuilder('token');

            // Thêm điều kiện tìm kiếm
            queryBuilder.where(new Brackets(qb => {
                qb.where('token.slt_name ILIKE :search', { search: `%${search}%` })
                    .orWhere('token.slt_symbol ILIKE :search', { search: `%${search}%` })
                    .orWhere('token.slt_address ILIKE :search', { search: `%${search}%` });
            }));

            // Thêm điều kiện lọc theo verified nếu có
            if (verified !== undefined) {
                queryBuilder.andWhere('token.slt_is_verified = :verified', { verified });
            }

            // Thêm điều kiện lọc cơ bản
            queryBuilder.andWhere('token.slt_name IS NOT NULL AND TRIM(token.slt_name) != \'\'');
            queryBuilder.andWhere('token.slt_symbol IS NOT NULL AND TRIM(token.slt_symbol) != \'\'');
            queryBuilder.andWhere('token.slt_logo_url IS NOT NULL AND TRIM(token.slt_logo_url) != \'\'');

            // Sắp xếp kết quả
            queryBuilder.orderBy('token.slt_market_cap', 'DESC')
                .addOrderBy('token.slt_name', 'ASC');

            // Áp dụng phân trang
            queryBuilder.skip(skip).take(limit);

            const [tokens, total] = await queryBuilder.getManyAndCount();

            return {
                status: 200,
                data: {
                    tokens: tokens.map(this.mapToDto),
                    total,
                    page,
                    limit,
                    query: search,
                    executionTime: Date.now() - startTime
                }
            };
        } catch (error) {
            return {
                status: 500,
                message: `Error searching tokens: ${error.message}`
            };
        }
    }

    async getMyWishlist(walletId: number): Promise<{ status: number; data?: any; message?: string }> {
        try {
            const wishlistTokens = await this.wishlistTokenRepository.find({
                where: {
                    swt_wallet_id: walletId,
                    swt_status: WishlistStatus.ON
                },
                relations: ['token'],
                order: {
                    swt_updated_at: 'DESC'
                }
            });
            
            return {
                status: 200,
                data: {
                    tokens: wishlistTokens.map(item => this.mapToDto(item.token)),
                    total: wishlistTokens.length
                }
            };
        } catch (error) {
            return {
                status: 500,
                message: `Error fetching wishlist tokens: ${error.message}`
            };
        }
    }

    async toggleWishlist(walletId: number, tokenAddress: string, status: string): Promise<{ status: number; message: string; data?: any }> {
        try {
            // Kiểm tra và lưu token nếu chưa tồn tại
            const checkResult = await this.checkAndSaveToken(tokenAddress);
            if (checkResult.status !== 200 || !checkResult.data) {
                return {
                    status: checkResult.status,
                    message: checkResult.message || 'Token not found'
                };
            }

            const tokenId = checkResult.data.id;

            // Kiểm tra xem đã tồn tại trong wishlist chưa
            const existing = await this.wishlistTokenRepository.findOne({
                where: {
                    swt_wallet_id: walletId,
                    swt_token_id: tokenId
                }
            });

            if (status === 'on') {
                if (!existing) {
                    // Kiểm tra số lượng token đang ON trong wishlist
                    const activeWishlistCount = await this.wishlistTokenRepository.count({
                        where: {
                            swt_wallet_id: walletId,
                            swt_status: WishlistStatus.ON
                        }
                    });

                    if (activeWishlistCount >= 3) {
                        // Nếu đã có 3 token ON, tìm token cũ nhất để chuyển sang OFF
                        const oldestActiveToken = await this.wishlistTokenRepository.findOne({
                            where: {
                                swt_wallet_id: walletId,
                                swt_status: WishlistStatus.ON
                            },
                            order: {
                                swt_updated_at: 'ASC'
                            }
                        });

                        if (oldestActiveToken) {
                            oldestActiveToken.swt_status = WishlistStatus.OFF;
                            await this.wishlistTokenRepository.save(oldestActiveToken);
                        }
                    }

                    // Thêm token mới vào wishlist
                    const newWishlist = this.wishlistTokenRepository.create({
                        swt_wallet_id: walletId,
                        swt_token_id: tokenId,
                        swt_status: WishlistStatus.ON
                    });
                    await this.wishlistTokenRepository.save(newWishlist);
                    return {
                        status: 200,
                        message: 'Token added to wishlist',
                        data: { status: WishlistStatus.ON }
                    };
                } else if (existing.swt_status === WishlistStatus.OFF) {
                    // Kiểm tra số lượng token đang ON trong wishlist
                    const activeWishlistCount = await this.wishlistTokenRepository.count({
                        where: {
                            swt_wallet_id: walletId,
                            swt_status: WishlistStatus.ON
                        }
                    });

                    if (activeWishlistCount >= 3) {
                        // Nếu đã có 3 token ON, tìm token cũ nhất để chuyển sang OFF
                        const oldestActiveToken = await this.wishlistTokenRepository.findOne({
                            where: {
                                swt_wallet_id: walletId,
                                swt_status: WishlistStatus.ON
                            },
                            order: {
                                swt_updated_at: 'ASC'
                            }
                        });

                        if (oldestActiveToken) {
                            oldestActiveToken.swt_status = WishlistStatus.OFF;
                            await this.wishlistTokenRepository.save(oldestActiveToken);
                        }
                    }

                    // Chuyển token hiện tại sang ON
                    existing.swt_status = WishlistStatus.ON;
                    await this.wishlistTokenRepository.save(existing);
                    return {
                        status: 200,
                        message: 'Token status updated to ON',
                        data: { status: WishlistStatus.ON }
                    };
                } else {
                    // Nếu token đã ON, không làm gì
                    return {
                        status: 200,
                        message: 'Token is already in wishlist',
                        data: { status: WishlistStatus.ON }
                    };
                }
            } else if (status === 'off') {
                if (existing && existing.swt_status === WishlistStatus.ON) {
                    // Chuyển token sang OFF
                    existing.swt_status = WishlistStatus.OFF;
                    await this.wishlistTokenRepository.save(existing);
                    return {
                        status: 200,
                        message: 'Token status updated to OFF',
                        data: { status: WishlistStatus.OFF }
                    };
                } else if (existing && existing.swt_status === WishlistStatus.OFF) {
                    // Nếu token đã OFF, không làm gì
                    return {
                        status: 200,
                        message: 'Token is already OFF in wishlist',
                        data: { status: WishlistStatus.OFF }
                    };
                } else {
                    // Nếu token không tồn tại trong wishlist
                    return {
                        status: 400,
                        message: 'Token not found in wishlist',
                        data: { status: WishlistStatus.OFF }
                    };
                }
            } else {
                return {
                    status: 400,
                    message: 'Invalid status. Must be "on" or "off"'
                };
            }
        } catch (error) {
            console.error('Error in toggleWishlist:', error);
            return {
                status: 500,
                message: `Error updating wishlist: ${error.message}`
            };
        }
    }

    private async determineTokenProgram(txHash: string): Promise<TokenProgram> {
        try {
            // Lấy thông tin transaction từ Solana RPC
            const transaction = await this.solanaService.getTransaction(txHash);
            
            if (!transaction) {
                return TokenProgram.OTHER;
            }

            // Kiểm tra program ID trong transaction
            const programId = transaction.transaction.message.getAccountKeys()[0].pubkey;
            
            // Danh sách program ID của các nguồn
            const programIds = {
                [TokenProgram.PUMPFUN]: ['pumpfun_program_id'],
                [TokenProgram.KCM]: ['kcm_program_id'],
                [TokenProgram.RAYDIUM]: ['raydium_program_id'],
                [TokenProgram.JUPITER]: ['jupiter_program_id'],
                [TokenProgram.GMGN]: ['gmgn_program_id']
            };

            // Tìm nguồn gốc token dựa vào program ID
            for (const [program, ids] of Object.entries(programIds)) {
                if (ids.includes(programId)) {
                    return program as TokenProgram;
                }
            }

            return TokenProgram.OTHER;
        } catch (error) {
            this.logger.error(`Error determining token program: ${error.message}`);
            return TokenProgram.OTHER;
        }
    }

    async create(tokenData: Partial<SolanaListToken>) {
        // Nếu có transaction hash, xác định nguồn gốc token
        if (tokenData.slt_transaction_hash) {
            const program = await this.determineTokenProgram(tokenData.slt_transaction_hash);
            tokenData.slt_program = program;
        }

        const token = this.solanaTokenRepository.create(tokenData);
        return this.solanaTokenRepository.save(token);
    }

    async getTokenInfo(address: string): Promise<{ status: number; data?: SolanaTokenDto; message?: string }> {
        try {
            if (!address) {
                return {
                    status: 400,
                    message: 'Token address is required'
                };
            }

            // Luôn lấy thông tin trade data mới nhất từ Birdeye
            const tradeData = await this.birdeyeService.getTokenTradeData(address);
            if (!tradeData) {
                return {
                    status: 404,
                    message: 'Token not found in Birdeye'
                };
            }

            // Kiểm tra token đã tồn tại trong database chưa
            const existingToken = await this.solanaTokenRepository.findOne({
                where: { slt_address: address }
            });

            // Tạo DTO với giá mới nhất từ Birdeye
            const tokenDto: SolanaTokenDto = {
                id: existingToken?.slt_id || 0,
                name: tradeData.name || '',
                symbol: tradeData.symbol || '',
                address: address,
                decimals: tradeData.decimals || 9,
                logoUrl: tradeData.logoURI || '',
                coingeckoId: tradeData.extensions?.coingeckoId,
                tradingviewSymbol: tradeData.extensions?.serumV3Usdc,
                isVerified: false,
                marketCap: tradeData.marketCap || 0,
                volume24h: tradeData.v24hUSD || 0,
                liquidity: tradeData.liquidity || 0,
                holders: tradeData.holder || 0,
                twitter: tradeData.extensions?.twitter || '',
                telegram: tradeData.extensions?.telegram || '',
                website: tradeData.extensions?.website || '',
                price: tradeData.price // Giá từ Birdeye đã là number
            };

            return {
                status: 200,
                data: tokenDto
            };
        } catch (error) {
            this.logger.error(`Error getting token info: ${error.message}`);
            return {
                status: 500,
                message: `Error getting token info: ${error.message}`
            };
        }
    }

    private async checkAndSaveToken(address: string): Promise<{ status: number; data?: SolanaTokenDto; message?: string }> {
        try {
            // Kiểm tra token đã tồn tại trong database chưa
            const existingToken = await this.solanaTokenRepository.findOne({
                where: { slt_address: address }
            });

            if (existingToken) {
                return {
                    status: 200,
                    data: this.mapToDto(existingToken)
                };
            }

            // Nếu không tồn tại, lấy thông tin từ Birdeye
            const birdeyeInfo = await this.birdeyeService.getTokenTradeData(address);
            
            if (!birdeyeInfo) {
                return {
                    status: 404,
                    message: 'Token not found in Birdeye'
                };
            }

            // Tạo token mới từ thông tin Birdeye
            const newToken = await this.create({
                slt_address: address,
                slt_name: birdeyeInfo.name || '',
                slt_symbol: birdeyeInfo.symbol || '',
                slt_decimals: birdeyeInfo.decimals || 9,
                slt_logo_url: birdeyeInfo.logoURI || undefined,
                slt_coingecko_id: birdeyeInfo.extensions?.coingeckoId || undefined,
                slt_tradingview_symbol: birdeyeInfo.extensions?.serumV3Usdc || undefined,
                slt_is_verified: false,
                slt_market_cap: birdeyeInfo.marketCap || 0,
                slt_price: birdeyeInfo.price || 0,
                slt_metadata_uri: undefined,
                slt_description: '',
                slt_twitter: birdeyeInfo.extensions?.twitter || '',
                slt_telegram: birdeyeInfo.extensions?.telegram || '',
                slt_website: birdeyeInfo.extensions?.website || '',
                slt_transaction_hash: undefined,
                slt_wallet_id: undefined,
                slt_program: TokenProgram.OTHER,
                slt_initial_liquidity: 0,
                slt_create_check: false,
                slt_category: undefined
            });

            return {
                status: 200,
                data: this.mapToDto(newToken)
            };
        } catch (error) {
            this.logger.error(`Error checking and saving token: ${error.message}`);
            return {
                status: 500,
                message: `Error checking and saving token: ${error.message}`
            };
        }
    }
}