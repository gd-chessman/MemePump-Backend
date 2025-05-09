import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Connection, PublicKey, ConfirmedSignatureInfo } from '@solana/web3.js';
import { SolanaService } from '../solana/solana.service';
import { SolanaWebSocketService } from '../solana/solana-websocket.service';
import { Logger } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { BirdeyeService, OHLCVData, Timeframe } from './birdeye.service';
import { ConfigService } from '@nestjs/config';
import { GetHistoriesTransactionDto } from './dto/get-histories-transaction.dto';

type ChartUpdateCallback = (data: any) => void;

@Injectable()
export class OnChainService implements OnModuleInit, OnModuleDestroy {
    private readonly CACHE_TTL = {
        HISTORICAL_TX: 3600,    // 1 hour
        PRICE: 300,            // 5 minutes
        OHLCV: 900            // 15 minutes
    };

    private ohlcvData: Map<string, OHLCVData[]> = new Map();
    private currentCandle: Map<string, OHLCVData> = new Map();
    private tokenPrices: Map<string, number> = new Map();
    private trackedTokens: Set<string> = new Set();
    private updateCallbacks: Map<string, Set<ChartUpdateCallback>> = new Map();
    private readonly logger = new Logger(OnChainService.name);

    constructor(
        private readonly eventEmitter: EventEmitter2,
        private readonly solanaService: SolanaService,
        private readonly solanaWebSocketService: SolanaWebSocketService,
        private readonly cacheService: CacheService,
        private readonly birdeyeService: BirdeyeService,
        private readonly configService: ConfigService
    ) { }

    async onModuleInit() {
        this.solanaWebSocketService.registerEventListener('account.changed', 'on-chain', (data) => {
            this.handleAccountChange('on-chain', data);
        });
    }

    onModuleDestroy() {
        this.trackedTokens.forEach(token => {
            this.solanaWebSocketService.unsubscribeFromWallet(token, 'on-chain');
        });
    }

    async subscribeToToken(tokenAddress: string, callback: (data: any) => void) {
        try {
            // Add callback to token callbacks
            if (!this.updateCallbacks.has(tokenAddress)) {
                this.updateCallbacks.set(tokenAddress, new Set());
            }
            this.updateCallbacks.get(tokenAddress)?.add(callback);

            // Add token to tracked tokens
            this.trackedTokens.add(tokenAddress);

            // Subscribe to Solana account changes
            await this.solanaService.trackAccountChanges(new PublicKey(tokenAddress));

            // Register event listener for account changes
            this.solanaService.getWebSocketService().registerEventListener('account.changed', tokenAddress, (data) => {
                this.handleAccountChange(tokenAddress, data);
            });

            this.logger.log(`Subscribed to token ${tokenAddress} for real-time updates`);
        } catch (error) {
            this.logger.error(`Error subscribing to token ${tokenAddress}:`, error);
            throw error;
        }
    }

    unsubscribeFromToken(tokenAddress: string) {
        this.updateCallbacks.delete(tokenAddress);
        if (this.trackedTokens.has(tokenAddress)) {
            this.solanaWebSocketService.unsubscribeFromWallet(tokenAddress, 'on-chain');
            this.trackedTokens.delete(tokenAddress);
        }
    }

    private async handleAccountChange(tokenAddress: string, data: any) {
        try {
            if (!this.trackedTokens.has(tokenAddress)) {
                return;
            }

            // Get current price from transaction data
            const priceData = await this.solanaService.getTokenPriceInRealTime(tokenAddress);
            const price = priceData.priceSOL;
            const volume = this.extractVolumeFromAccountData(data);

            // Update OHLCV data
            await this.updateOHLCVData(tokenAddress, price, volume);

            // Get current candle
            const currentCandle = this.getCurrentCandle(tokenAddress);

            // Notify all callbacks
            const callbacks = this.updateCallbacks.get(tokenAddress);
            if (callbacks) {
                callbacks.forEach(callback => callback(currentCandle));
            }

            this.logger.debug(`Updated OHLCV data for ${tokenAddress}:`, currentCandle);
        } catch (error) {
            this.logger.error(`Error handling account change for ${tokenAddress}:`, error);
        }
    }

    private async updateOHLCVData(tokenAddress: string, price: number, volume: number) {
        try {
            const currentTime = this.getCandleStartTime(Date.now());
            let currentCandle = this.currentCandle.get(tokenAddress);

            // Validate price and volume
            if (price <= 0) {
                this.logger.warn(`Invalid price ${price} for token ${tokenAddress}`);
                return;
            }

            if (!currentCandle || currentTime > currentCandle.time) {
                // Save old candle to history if exists
                if (currentCandle) {
                    const historicalData = this.ohlcvData.get(tokenAddress) || [];
                    historicalData.push({ ...currentCandle });

                    // Keep last 100 candles
                    if (historicalData.length > 100) {
                        historicalData.shift();
                    }
                    this.ohlcvData.set(tokenAddress, historicalData);
                }

                // Create new candle
                currentCandle = {
                    time: currentTime,
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    volume: volume || 0
                };
                this.currentCandle.set(tokenAddress, currentCandle);
            } else {
                // Update current candle
                currentCandle.high = Math.max(currentCandle.high, price);
                currentCandle.low = Math.min(currentCandle.low, price);
                currentCandle.close = price;
                currentCandle.volume += volume || 0;
            }

            // Update token price
            this.tokenPrices.set(tokenAddress, price);

            // Emit update event
            const historicalData = this.ohlcvData.get(tokenAddress) || [];
            this.eventEmitter.emit('tradingview.update', {
                tokenAddress,
                data: historicalData,
                current: currentCandle
            });

            this.logger.debug(`Updated OHLCV data for ${tokenAddress}:`, {
                time: new Date(currentCandle.time).toISOString(),
                open: currentCandle.open,
                high: currentCandle.high,
                low: currentCandle.low,
                close: currentCandle.close,
                volume: currentCandle.volume
            });
        } catch (error) {
            this.logger.error(`Error updating OHLCV data for ${tokenAddress}:`, error);
        }
    }

    private getCandleStartTime(timestamp: number): number {
        // Round down to the nearest minute
        return Math.floor(timestamp / 60000) * 60000;
    }

    async getChart(
        tokenAddress: string,
        timeframe: Timeframe = '5m',
        timeFrom?: number,
        timeTo?: number
    ): Promise<{
        historical: OHLCVData[];
        current: OHLCVData;
    }> {
        try {
            this.logger.log(`[Chart] Fetching chart data for ${tokenAddress} (${timeframe})`);

            // Validate token address
            if (!tokenAddress) {
                throw new Error('Token address is required');
            }

            // Get OHLCV data
            const ohlcvData = await this.birdeyeService.getOHLCVData(tokenAddress, timeframe);

            // Get current price data
            const priceData = await this.solanaService.getTokenPriceInRealTime(tokenAddress);
            
            // Create current candle
            const currentTime = Math.floor(Date.now() / 1000);
            const currentCandle = {
                time: currentTime,
                open: priceData.priceUSD,
                high: priceData.priceUSD,
                low: priceData.priceUSD,
                close: priceData.priceUSD,
                volume: 0 // Volume will be updated in real-time
            };

            // Filter data by time range if provided
            let filteredData = ohlcvData;
            if (timeFrom && timeTo) {
                filteredData = ohlcvData.filter(item => 
                    item.time >= timeFrom && item.time <= timeTo
                );
            }

            return {
                historical: filteredData,
                current: currentCandle
            };
        } catch (error) {
            this.logger.error(`[Chart] Error fetching chart data: ${error.message}`);
            throw error;
        }
    }

    private extractVolumeFromAccountData(data: any): number {
        try {
            if (!data) return 0;

            // Handle different data formats
            if (Array.isArray(data)) {
                return data.reduce((sum, item) => sum + (item.amount || 0), 0);
            } else if (typeof data === 'object') {
                return data.amount || 0;
            }

            return 0;
        } catch (error) {
            this.logger.error('Error extracting volume from account data:', error);
            return 0;
        }
    }

    private convertTransactionsToOHLCV(transactions: any[]): OHLCVData[] {
        const ohlcvMap = new Map<number, OHLCVData>();

        transactions.forEach(tx => {
            if (!tx || !tx.blockTime) return;

            const candleTime = Math.floor(tx.blockTime / 60) * 60 * 1000;
            const price = this.extractPriceFromTransaction(tx);
            const volume = this.extractVolumeFromTransaction(tx);

            if (!price || !volume) return;

            if (!ohlcvMap.has(candleTime)) {
                ohlcvMap.set(candleTime, {
                    time: candleTime,
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    volume: volume
                });
            } else {
                const candle = ohlcvMap.get(candleTime);
                if (!candle) return;

                candle.high = Math.max(candle.high, price);
                candle.low = Math.min(candle.low, price);
                candle.close = price;
                candle.volume += volume;
            }
        });

        const sortedData = Array.from(ohlcvMap.values())
            .sort((a, b) => a.time - b.time)
            .slice(-100);

        return sortedData;
    }

    private extractPriceFromTransaction(tx: any): number | null {
        try {
            if (!tx.meta) return null;

            const preBalances = tx.meta.preTokenBalances || [];
            const postBalances = tx.meta.postTokenBalances || [];

            if (preBalances.length > 0 && postBalances.length > 0) {
                const preAmount = Number(preBalances[0].uiTokenAmount.uiAmount);
                const postAmount = Number(postBalances[0].uiTokenAmount.uiAmount);

                if (preAmount !== postAmount) {
                    return postAmount / preAmount;
                }
            }
            return null;
        } catch (error) {
            console.error('Error extracting price from transaction:', error);
            return null;
        }
    }

    private extractVolumeFromTransaction(tx: any): number | null {
        try {
            if (!tx.meta) return null;

            const preBalances = tx.meta.preTokenBalances || [];
            const postBalances = tx.meta.postTokenBalances || [];

            if (preBalances.length > 0 && postBalances.length > 0) {
                const preAmount = Number(preBalances[0].uiTokenAmount.uiAmount);
                const postAmount = Number(postBalances[0].uiTokenAmount.uiAmount);

                return Math.abs(postAmount - preAmount);
            }
            return null;
        } catch (error) {
            console.error('Error extracting volume from transaction:', error);
            return null;
        }
    }

    async getHistoricalTransactions(dto: GetHistoriesTransactionDto) {
        try {
            this.logger.debug(`Getting historical transactions with params: ${JSON.stringify(dto)}`);
            
            const result = await this.birdeyeService.getTransactionHistory(dto);
            
            this.logger.debug(`Successfully fetched ${result.data.items.length} transactions`);
            return result;
        } catch (error) {
            this.logger.error(`Error getting historical transactions: ${error.message}`, error.stack);
            throw error;
        }
    }

    getCurrentCandle(tokenAddress: string): OHLCVData {
        return this.currentCandle.get(tokenAddress) || {
            time: Math.floor(Date.now() / 1000) * 1000,
            open: 0,
            high: 0,
            low: 0,
            close: 0,
            volume: 0
        };
    }

    isTokenTracked(tokenAddress: string): boolean {
        return this.trackedTokens.has(tokenAddress);
    }
} 