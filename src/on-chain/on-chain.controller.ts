import { Controller, Get, UseGuards, Query, Param, Post, Body, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OnChainService } from './on-chain.service';
import { BirdeyeService, Timeframe } from './birdeye.service';
import { PublicKey } from '@solana/web3.js';
import { SolanaService } from '../solana/solana.service';
import { GetHistoriesTransactionDto } from './dto/get-histories-transaction.dto';
import { GetTopCoinsDto } from '../trade/dto/get-top-coins.dto';
import { TopCoinsResponse } from './birdeye.service';

interface TradingViewResponse {
    success: boolean;
    data?: {
        historical: Array<{
            time: number;
            open: number;
            high: number;
            low: number;
            close: number;
            volume: number;
        }>;
        current: {
            time: number;
            open: number;
            high: number;
            low: number;
            close: number;
            volume: number;
        } | null;
    };
    error?: string;
}

@Controller('on-chain')
@UseGuards(JwtAuthGuard)
export class OnChainController {
    private readonly logger = new Logger(OnChainController.name);

    constructor(
        private readonly onChainService: OnChainService,
        private readonly birdeyeService: BirdeyeService,
        private readonly solanaService: SolanaService
    ) { }

    @Get('chart/:tokenAddress')
    async getTradingViewChart(
        @Param('tokenAddress') tokenAddress: string,
        @Query('timeframe') timeframe: Timeframe = '5m',
        @Query('time_from') timeFrom?: number,
        @Query('time_to') timeTo?: number
    ): Promise<TradingViewResponse> {
        try {
            const data = await this.onChainService.getChart(
                tokenAddress,
                timeframe,
                timeFrom,
                timeTo
            );
            return {
                success: true,
                data
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    @Get('clear-cache')
    async clearCache(@Query('tokenAddress') tokenAddress: string) {
        await this.birdeyeService.clearOHLCVCache(tokenAddress);
        return { success: true, message: 'Cache cleared successfully' };
    }

    @Post('test-chart')
    async testChart(@Body() data: { tokenAddress: string }) {
        try {
            const { tokenAddress } = data;
            this.logger.log(`Testing chart data for token: ${tokenAddress}`);

            // Validate token address
            if (!tokenAddress) {
                throw new Error('Token address is required');
            }

            // Get initial price data
            const priceData = await this.solanaService.getTokenPriceInRealTime(tokenAddress);
            if (!priceData || priceData.priceUSD <= 0) {
                throw new Error('Unable to get initial price data for token');
            }

            // Subscribe to token for real-time updates
            await this.onChainService.subscribeToToken(tokenAddress, (updateData) => {
                this.logger.debug('Received real-time update:', {
                    tokenAddress,
                    time: new Date(updateData.time).toISOString(),
                    price: updateData.close,
                    volume: updateData.volume
                });
            });

            // Get current candle data
            const currentCandle = this.onChainService.getCurrentCandle(tokenAddress);
            
            // Validate candle data
            if (!currentCandle || currentCandle.close <= 0) {
                throw new Error('Invalid candle data received');
            }

            // Log detailed information
            this.logger.debug('Current candle data:', {
                tokenAddress,
                time: new Date(currentCandle.time).toISOString(),
                open: currentCandle.open,
                high: currentCandle.high,
                low: currentCandle.low,
                close: currentCandle.close,
                volume: currentCandle.volume
            });

            return {
                success: true,
                data: {
                    ...currentCandle,
                    priceUSD: priceData.priceUSD,
                    priceSOL: priceData.priceSOL
                }
            };
        } catch (error) {
            this.logger.error('Error in test-chart:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    @Get('histories')
    async getHistories(@Query() query: GetHistoriesTransactionDto) {
        try {
            return await this.birdeyeService.getTransactionHistory(query);
        } catch (error) {
            this.logger.error(`Error getting transaction history: ${error.message}`);
            throw error;
        }
    }

    @Get('top-coins')
    async getTopCoins(@Query() query: GetTopCoinsDto): Promise<TopCoinsResponse> {
        try {
            const response = await this.birdeyeService.getTopCoins(query);
            return {
                ...response,
                data: {
                    ...response.data,
                    items: response.data.items.map(item => ({
                        address: item.address,
                        logo_uri: item.logo_uri,
                        name: item.name,
                        symbol: item.symbol,
                        decimals: item.decimals,
                        extensions: item.extensions,
                        market_cap: item.market_cap,
                        fdv: item.fdv,
                        liquidity: item.liquidity,
                        last_trade_unix_time: item.last_trade_unix_time,
                        volume_1h_usd: item.volume_1h_usd,
                        volume_1h_change_percent: item.volume_1h_change_percent,
                        volume_24h_usd: item.volume_24h_usd,
                        volume_24h_change_percent: item.volume_24h_change_percent,
                        trade_24h_count: item.trade_24h_count,
                        price: item.price,
                        price_change_24h_percent: item.price_change_24h_percent,
                        holder: item.holder,
                        recent_listing_time: item.recent_listing_time
                    }))
                }
            };
        } catch (error) {
            this.logger.error(`Error getting top coins: ${error.message}`);
            throw error;
        }
    }
}
