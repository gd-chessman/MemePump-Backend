import { Controller, Get, Param, Query, UseGuards, Patch, Body, HttpException, HttpStatus, Post, Req } from '@nestjs/common';
import { SolanaTokensService } from './solana-tokens.service';
import { SolanaTokenDto, SolanaTokensResponseDto, SolanaTokenQueryDto } from './dto/solana-token.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateTradingviewSymbolDto } from './dto/update-tradingview-symbol.dto';
import { TokenPriceResponseDto } from './dto/token-price.dto';
import { SolanaService } from './solana.service';
import { Request } from 'express';
import { BirdeyeService } from '../on-chain/birdeye.service';
import { TokenProgram } from './entities/solana-list-token.entity';
import { BirdeyeTokenOrigin } from '../on-chain/interfaces/birdeye-token.interface';
import { ToggleWishlistDto } from './dto/toggle-wishlist.dto';
import { Logger } from '@nestjs/common';
import { SolanaPriceCacheService } from './solana-price-cache.service';
import { CacheService } from '../cache/cache.service';

interface RequestWithUser extends Request {
    user: {
        wallet_id: number;
    };
}

@ApiTags('Solana Tokens')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('solana-tokens')
export class SolanaTokensController {
    private readonly logger = new Logger(SolanaTokensController.name);

    constructor(
        private readonly solanaTokensService: SolanaTokensService,
        private readonly solanaService: SolanaService,
        private readonly birdeyeService: BirdeyeService,
        private readonly solanaPriceCacheService: SolanaPriceCacheService,
        private readonly cacheService: CacheService
    ) { }

    @Get()
    @ApiOperation({ summary: 'Get all Solana tokens with pagination and filtering' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'search', required: false, type: String })
    @ApiQuery({ name: 'verified', required: false, type: Boolean })
    @ApiQuery({ name: 'random', required: false, type: Boolean, description: 'Get tokens in random order' })
    @ApiResponse({ status: 200, description: 'Return all tokens', type: SolanaTokensResponseDto })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    async findAll(@Query() query: SolanaTokenQueryDto) {
        try {
            const result = await this.solanaTokensService.findAll(query);
            
            if (result.status !== 200) {
                throw new HttpException({
                    status: result.status,
                    error: result.message,
                    message: 'Failed to fetch tokens'
                }, result.status);
            }

            return result;
        } catch (error) {
            throw new HttpException({
                status: HttpStatus.INTERNAL_SERVER_ERROR,
                error: error.message,
                message: 'Failed to fetch tokens'
            }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('search')
    @ApiOperation({ summary: 'Search tokens by name, symbol or address' })
    @ApiQuery({ name: 'query', required: true, type: String, description: 'Search term' })
    @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
    @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page' })
    @ApiQuery({ name: 'verified', required: false, type: Boolean, description: 'Filter by verified status' })
    @ApiResponse({ status: 200, description: 'Return matching tokens', type: SolanaTokensResponseDto })
    @ApiResponse({ status: 400, description: 'Invalid search query' })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    async searchTokens(
        @Query('query') searchQuery: string,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
        @Query('verified') verified?: boolean
    ) {
        try {
            if (!searchQuery || searchQuery.trim() === '') {
                throw new HttpException({
                    status: HttpStatus.BAD_REQUEST,
                    error: 'Missing search query',
                    message: 'Search term is required'
                }, HttpStatus.BAD_REQUEST);
            }

            const result = await this.solanaTokensService.searchTokens({
                search: searchQuery,
                page,
                limit,
                verified
            });

            if (result.status !== 200) {
                throw new HttpException({
                    status: result.status,
                    error: result.message,
                    message: 'Failed to search tokens'
                }, result.status);
            }

            return result;
        } catch (error) {
            throw new HttpException({
                status: error.status || HttpStatus.INTERNAL_SERVER_ERROR,
                error: error.message,
                message: 'Failed to search tokens'
            }, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('token-price')
    @ApiOperation({ summary: 'Get real-time token price in USD and SOL' })
    @ApiQuery({ name: 'address', required: true, type: String, description: 'Token mint address' })
    @ApiResponse({ status: 200, description: 'Return token price', type: TokenPriceResponseDto })
    @ApiResponse({ status: 400, description: 'Invalid token address' })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    async getTokenPrice(@Query('address') address: string) {
        try {
            if (!address) {
                throw new HttpException({
                    status: HttpStatus.BAD_REQUEST,
                    error: 'Missing token address',
                    message: 'Token address is required'
                }, HttpStatus.BAD_REQUEST);
            }

            // Thử lấy giá từ Birdeye trước
            try {
                const birdeyePrice = await this.birdeyeService.getCurrentPrice(address);
                if (birdeyePrice.priceUSD > 0) {
                    return {
                        status: HttpStatus.OK,
                        data: {
                            priceUSD: birdeyePrice.priceUSD,
                            priceSOL: birdeyePrice.priceSOL
                        }
                    };
                }
            } catch (birdeyeError) {
                this.logger.warn(`Failed to get price from Birdeye: ${birdeyeError.message}`);
            }

            // Nếu Birdeye thất bại hoặc trả về giá = 0, thử dùng Jupiter
            const jupiterResult = await this.solanaService.getTokenPriceInRealTime(address);

            if (jupiterResult.error) {
                // Nếu cả hai API đều thất bại, trả về giá 0
                return {
                    status: HttpStatus.OK,
                    data: {
                        priceUSD: 0,
                        priceSOL: 0
                    }
                };
            }

            return {
                status: HttpStatus.OK,
                data: {
                    priceUSD: jupiterResult.priceUSD,
                    priceSOL: jupiterResult.priceSOL
                }
            };
        } catch (error) {
            throw new HttpException({
                status: error.status || HttpStatus.INTERNAL_SERVER_ERROR,
                error: error.message,
                message: 'Failed to get token price'
            }, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('address/:address')
    @ApiOperation({ summary: 'Get a token by address' })
    @ApiParam({ name: 'address', type: 'string' })
    @ApiResponse({ status: 200, description: 'Return the token', type: SolanaTokenDto })
    @ApiResponse({ status: 404, description: 'Token not found' })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    async findByAddress(@Param('address') address: string) {
        try {
            if (!address) {
                throw new HttpException({
                    status: HttpStatus.BAD_REQUEST,
                    error: 'Missing token address',
                    message: 'Token address is required'
                }, HttpStatus.BAD_REQUEST);
            }

            const result = await this.solanaTokensService.findByAddress(address);

            if (result.status !== 200) {
                throw new HttpException({
                    status: result.status,
                    error: result.message,
                    message: result.status === 404 ? 'Token not found' : 'Failed to fetch token'
                }, result.status);
            }

            return result;
        } catch (error) {
            throw new HttpException({
                status: error.status || HttpStatus.INTERNAL_SERVER_ERROR,
                error: error.message,
                message: 'Failed to fetch token'
            }, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('get-my-wishlist')
    @ApiOperation({ summary: 'Get my wishlist tokens' })
    @ApiResponse({ status: 200, description: 'Return all tokens in my wishlist' })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    async getMyWishlist(@Req() req: RequestWithUser) {
        try {
            const walletId = req.user.wallet_id;
            if (!walletId) {
                throw new HttpException({
                    status: HttpStatus.UNAUTHORIZED,
                    error: 'Unauthorized',
                    message: 'Wallet ID not found in token'
                }, HttpStatus.UNAUTHORIZED);
            }

            const result = await this.solanaTokensService.getMyWishlist(walletId);

            if (result.status !== 200) {
                throw new HttpException({
                    status: result.status,
                    error: result.message,
                    message: 'Failed to fetch wishlist tokens'
                }, result.status);
            }

            return result;
        } catch (error) {
            throw new HttpException({
                status: error.status || HttpStatus.INTERNAL_SERVER_ERROR,
                error: error.message,
                message: 'Failed to fetch wishlist tokens'
            }, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Post('toggle-wishlist')
    @ApiOperation({ summary: 'Update token wishlist status' })
    @ApiBody({ type: ToggleWishlistDto })
    @ApiResponse({ status: 200, description: 'Wishlist status updated successfully' })
    @ApiResponse({ status: 400, description: 'Invalid parameters' })
    @ApiResponse({ status: 404, description: 'Token not found in wishlist' })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    async toggleWishlist(
        @Req() req: RequestWithUser,
        @Body() toggleDto: ToggleWishlistDto
    ) {
        try {
            const walletId = req.user.wallet_id;
            if (!walletId) {
                throw new HttpException({
                    status: HttpStatus.UNAUTHORIZED,
                    error: 'Unauthorized',
                    message: 'Wallet ID not found in token'
                }, HttpStatus.UNAUTHORIZED);
            }

            if (!toggleDto.token_address || !toggleDto.status) {
                throw new HttpException({
                    status: HttpStatus.BAD_REQUEST,
                    error: 'Missing required parameters',
                    message: 'Token address and status are required'
                }, HttpStatus.BAD_REQUEST);
            }

            if (toggleDto.status !== 'on' && toggleDto.status !== 'off') {
                throw new HttpException({
                    status: HttpStatus.BAD_REQUEST,
                    error: 'Invalid status',
                    message: 'Status must be either "on" or "off"'
                }, HttpStatus.BAD_REQUEST);
            }

            const result = await this.solanaTokensService.toggleWishlist(walletId, toggleDto.token_address, toggleDto.status);

            if (result.status !== 200) {
                throw new HttpException({
                    status: result.status,
                    error: result.message,
                    message: result.status === 404 ? 'Token not found in wishlist' : 'Failed to update wishlist status'
                }, result.status);
            }

            return result;
        } catch (error) {
            throw new HttpException({
                status: error.status || HttpStatus.INTERNAL_SERVER_ERROR,
                error: error.message,
                message: 'Failed to update wishlist status'
            }, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('origin/:address')
    @ApiOperation({ summary: 'Get token origin information' })
    @ApiParam({ name: 'address', type: 'string' })
    @ApiResponse({ status: 200, description: 'Return the token origin information' })
    @ApiResponse({ status: 404, description: 'Token origin information not found' })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    async getTokenOrigin(@Param('address') address: string): Promise<{ status: number; data?: BirdeyeTokenOrigin; message?: string }> {
        try {
            if (!address) {
                return {
                    status: 400,
                    message: 'Token address is required'
                };
            }

            const tokenOrigin = await this.birdeyeService.getTokenOrigin(address);

            if (!tokenOrigin) {
                return {
                    status: 404,
                    message: 'Token origin information not found'
                };
            }

            return {
                status: 200,
                data: tokenOrigin
            };
        } catch (error) {
            return {
                status: 500,
                message: `Error getting token origin: ${error.message}`
            };
        }
    }

    @Get('clear-cache')
    @ApiOperation({ summary: 'Clear token price cache' })
    @ApiResponse({ status: 200, description: 'Cache cleared successfully' })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    async clearCache() {
        try {
            await this.solanaPriceCacheService.clearCache();
            return {
                status: 200,
                message: 'Token price cache cleared successfully'
            };
        } catch (error) {
            throw new HttpException({
                status: HttpStatus.INTERNAL_SERVER_ERROR,
                error: error.message,
                message: 'Failed to clear cache'
            }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('clear-all-cache')
    @ApiOperation({ summary: 'Clear all cache in the system' })
    @ApiResponse({ status: 200, description: 'All cache cleared successfully' })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    async clearAllCache() {
        try {
            // Clear token price cache
            await this.solanaPriceCacheService.clearCache();
            
            // Clear all Redis cache
            await this.cacheService.reset();
            
            return {
                status: 200,
                message: 'All cache cleared successfully'
            };
        } catch (error) {
            throw new HttpException({
                status: HttpStatus.INTERNAL_SERVER_ERROR,
                error: error.message,
                message: 'Failed to clear all cache'
            }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('clear-all-balance-cache')
    @ApiOperation({ summary: 'Clear all wallet balance caches' })
    @ApiResponse({ status: 200, description: 'All wallet balance caches cleared successfully' })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    async clearAllBalanceCache() {
        try {
            await this.solanaService.clearAllBalanceCache();
            return {
                status: 200,
                message: 'All wallet balance caches cleared successfully'
            };
        } catch (error) {
            throw new HttpException({
                status: HttpStatus.INTERNAL_SERVER_ERROR,
                error: error.message,
                message: 'Failed to clear all wallet balance caches'
            }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a token by ID' })
    @ApiParam({ name: 'id', type: 'number' })
    @ApiResponse({ status: 200, description: 'Return the token', type: SolanaTokenDto })
    @ApiResponse({ status: 404, description: 'Token not found' })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    async findOne(@Param('id') id: number) {
        try {
            if (!id || isNaN(id)) {
                throw new HttpException({
                    status: HttpStatus.BAD_REQUEST,
                    error: 'Invalid token ID',
                    message: 'Valid token ID is required'
                }, HttpStatus.BAD_REQUEST);
            }

            const result = await this.solanaTokensService.findOne(id);

            if (result.status !== 200) {
                throw new HttpException({
                    status: result.status,
                    error: result.message,
                    message: result.status === 404 ? 'Token not found' : 'Failed to fetch token'
                }, result.status);
            }

            return result;
        } catch (error) {
            throw new HttpException({
                status: error.status || HttpStatus.INTERNAL_SERVER_ERROR,
                error: error.message,
                message: 'Failed to fetch token'
            }, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Patch('update-tradingview-symbol')
    @ApiOperation({ summary: 'Update TradingView symbol for a token' })
    @ApiBody({ type: UpdateTradingviewSymbolDto })
    @ApiResponse({ status: 200, description: 'TradingView symbol updated successfully' })
    @ApiResponse({ status: 404, description: 'Token not found' })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    async updateTradingviewSymbol(@Body() updateDto: UpdateTradingviewSymbolDto) {
        try {
            if (!updateDto.address || !updateDto.tradingviewSymbol) {
                throw new HttpException({
                    status: HttpStatus.BAD_REQUEST,
                    error: 'Missing required fields',
                    message: 'Token address and TradingView symbol are required'
                }, HttpStatus.BAD_REQUEST);
            }

            const result = await this.solanaTokensService.updateTradingviewSymbol(
                updateDto.address,
                updateDto.tradingviewSymbol
            );

            if (result.status !== 200) {
                throw new HttpException({
                    status: result.status,
                    error: result.message,
                    message: result.status === 404 ? 'Token not found' : 'Failed to update TradingView symbol'
                }, result.status);
            }

            return result;
        } catch (error) {
            throw new HttpException({
                status: error.status || HttpStatus.INTERNAL_SERVER_ERROR,
                error: error.message,
                message: 'Failed to update TradingView symbol'
            }, error.status || HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    @Get('force-update-sol-balance/:address')
    @ApiOperation({ summary: 'Force update SOL balance for an address' })
    @ApiParam({ name: 'address', type: 'string' })
    @ApiResponse({ status: 200, description: 'SOL balance updated successfully' })
    @ApiResponse({ status: 500, description: 'Internal server error' })
    async forceUpdateSolBalance(@Param('address') address: string) {
        try {
            if (!address) {
                throw new HttpException({
                    status: HttpStatus.BAD_REQUEST,
                    error: 'Missing address',
                    message: 'Address is required'
                }, HttpStatus.BAD_REQUEST);
            }

            // Clear existing cache
            await this.solanaService.clearBalanceCache(address);

            // Get fresh balance
            const balance = await this.solanaService.getBalance(address);

            return {
                status: 200,
                message: 'SOL balance updated successfully',
                data: {
                    address,
                    balance
                }
            };
        } catch (error) {
            throw new HttpException({
                status: HttpStatus.INTERNAL_SERVER_ERROR,
                error: error.message,
                message: 'Failed to update SOL balance'
            }, HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

} 