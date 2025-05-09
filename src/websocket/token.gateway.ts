import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Inject } from '@nestjs/common';
import { TradeService } from '../trade/trade.service';
import { SolanaService } from '../solana/solana.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SolanaListTokenRepository } from '../solana/repositories/solana-list-token.repository';
import { Not, IsNull, SelectQueryBuilder } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { SolanaListToken } from '../solana/entities/solana-list-token.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { BirdeyeService } from '../on-chain/birdeye.service';
import { CacheService } from '../cache/cache.service';

@Injectable()
@WebSocketGateway({
    namespace: 'token',
    transports: ['websocket'],
    path: '/socket.io',
    allowEIO3: true,
    allowEIO4: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 60000
})
export class TokenGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger('TokenGateway');
    private readonly MIN_UPDATE_INTERVAL = 500;
    private readonly MAX_UPDATE_INTERVAL = 2000;
    private readonly DEFAULT_UPDATE_INTERVAL = 1000;
    private currentUpdateInterval = 1000;
    private clientSubscriptions = new Map<string, { 
        interval: NodeJS.Timeout, 
        params: any,
        lastUpdateTime: number,
        lastQueryTime: number,
        queryCount: number,
        lastData: any
    }>();
    private readonly performanceMetrics = {
        queryTimes: [] as number[],
        maxQueryTimes: 50,
        lastAdjustmentTime: Date.now(),
        adjustmentInterval: 30000,
        performanceThreshold: 100,
        totalQueries: 0,
        successfulQueries: 0,
        failedQueries: 0,
        averageQueryTime: 0
    };
    private readonly MAX_RETRY_ATTEMPTS = 5;
    private readonly RETRY_DELAY = 5000;
    private readonly CACHE_TTL = 5; // 5 seconds

    constructor(
        @InjectRepository(SolanaListToken)
        private readonly solanaTokenRepository: SolanaListTokenRepository,
        private readonly tradeService: TradeService,
        private readonly solanaService: SolanaService,
        private readonly eventEmitter: EventEmitter2,
        private readonly dataSource: DataSource,
        private readonly configService: ConfigService,
        private readonly birdeyeService: BirdeyeService,
        private readonly cacheService: CacheService
    ) {
        this.logger.log('TokenGateway initialized');
        this.initializeRepository();
        this.setupEventListeners();
    }

    private setupEventListeners() {
        this.eventEmitter.on('token.new', async (data: any) => {
            this.logger.log(`[WS] New token received from ${data.metadata.source}`);
            
            // Validate logo URL for new token
            if (data.token.slt_logo_url) {
                try {
                    const url = new URL(data.token.slt_logo_url);
                    if (url.protocol === 'http:') {
                        data.token.slt_logo_url = data.token.slt_logo_url.replace('http:', 'https:');
                    }
                    // Thêm cache busting parameter
                    if (!url.searchParams.has('_cb')) {
                        data.token.slt_logo_url = `${data.token.slt_logo_url}${url.search ? '&' : '?'}_cb=${Date.now()}`;
                    }
                } catch (error) {
                    this.logger.warn(`Invalid logo URL for new token: ${data.token.slt_logo_url}`);
                    data.token.slt_logo_url = '';
                }
            }
            
            // Invalidate cache when new token is added
            const cacheKeys = await this.cacheService.keys();
            const tokenCacheKeys = cacheKeys.filter(key => key.startsWith('tokens:'));
            for (const key of tokenCacheKeys) {
                await this.cacheService.del(key);
            }
            
            for (const [clientId, subscription] of this.clientSubscriptions.entries()) {
                const adapterSockets = (this.server.sockets as any)?.sockets;
                const client = adapterSockets?.get?.(clientId);
                
                if (client && client.connected) {
                    try {
                        subscription.lastUpdateTime = Date.now();
                        client.emit('tokenUpdate', {
                            event: 'tokenUpdate',
                            data: {
                                tokens: [data.token],
                                total: 1,
                                metadata: {
                                    timestamp: data.metadata.timestamp,
                                    source: data.metadata.source,
                                    isNew: true,
                                    hasLogo: !!data.token.slt_logo_url
                                }
                            }
                        });
                    } catch (error) {
                        this.logger.error(`[WS] Error sending token update to client ${clientId}:`, error);
                    }
                }
            }
        });
    }

    private async initializeRepository() {
        try {
            const count = await this.solanaTokenRepository.count({});
            this.logger.log(`Repository initialized successfully with ${count} tokens`);
        } catch (error) {
            this.logger.error('Failed to initialize repository:', error);
            throw error;
        }
    }

    private handleError(client: Socket, error: any, context: string) {
        const errorMessage = {
            event: 'error',
            error: {
                context,
                message: error.message,
                timestamp: new Date(),
                code: error.code || 'UNKNOWN_ERROR'
            }
        };

        this.logger.error(`[${context}] Error for client ${client.id}: ${error.message}`);
        client.emit('error', errorMessage);

        this.eventEmitter.emit('websocket.error', {
            type: 'error',
            clientId: client.id,
            context,
            error: errorMessage,
            timestamp: new Date()
        });
    }

    async handleConnection(client: Socket) {
        try {
            this.logger.log(`[WS] New client connected: ${client.id}`);
            this.logConnectionStats();

            client.emit('connected', { 
                clientId: client.id,
                timestamp: new Date(),
                serverTime: Date.now()
            });

            const pingInterval = setInterval(() => {
                try {
                    if (client.connected) {
                        client.emit('ping');
                    }
                } catch (error) {
                    this.logger.error(`[WS] Ping error for client ${client.id}:`, error);
                    clearInterval(pingInterval);
                }
            }, 20000);

            client.on('error', (error) => {
                this.logger.error(`[WS] Client ${client.id} error:`, error);
                this.handleError(client, error, 'CLIENT_ERROR');
            });

            client.on('disconnect', (reason) => {
                this.logger.log(`[WS] Client ${client.id} disconnected. Reason: ${reason}`);
                clearInterval(pingInterval);
                this.cleanupClientSubscriptions(client.id);
                this.logConnectionStats();
            });

            client.on('connect_error', (error) => {
                this.logger.error(`[WS] Client ${client.id} connection error:`, error);
                this.handleError(client, error, 'CONNECT_ERROR');
            });

        } catch (error) {
            this.logger.error(`[WS] Connection setup error for client ${client.id}:`, error);
            this.handleError(client, error, 'CONNECTION_SETUP_ERROR');
        }
    }

    private logConnectionStats() {
        const totalConnections = this.server?.sockets?.sockets?.size || 0;
        const totalSubscriptions = this.clientSubscriptions.size;
        this.logger.log(`[WS Stats] Active connections: ${totalConnections}, Active subscriptions: ${totalSubscriptions}`);
        
        const {
            totalQueries,
            successfulQueries,
            failedQueries,
            averageQueryTime
        } = this.performanceMetrics;

        this.logger.log(`[WS Performance] 
            Total queries: ${totalQueries}
            Successful: ${successfulQueries}
            Failed: ${failedQueries}
            Average query time: ${averageQueryTime.toFixed(2)}ms
            Current update interval: ${this.currentUpdateInterval}ms`);
    }

    private updatePerformanceMetrics(queryTime: number, success: boolean = true) {
        this.performanceMetrics.queryTimes.push(queryTime);
        this.performanceMetrics.totalQueries++;
        
        if (success) {
            this.performanceMetrics.successfulQueries++;
        } else {
            this.performanceMetrics.failedQueries++;
        }

        if (this.performanceMetrics.queryTimes.length > this.performanceMetrics.maxQueryTimes) {
            this.performanceMetrics.queryTimes.shift();
        }

        this.performanceMetrics.averageQueryTime = 
            this.performanceMetrics.queryTimes.reduce((sum, time) => sum + time, 0) / 
            this.performanceMetrics.queryTimes.length;

        const now = Date.now();
        if (now - this.performanceMetrics.lastAdjustmentTime > this.performanceMetrics.adjustmentInterval) {
            this.adjustUpdateInterval();
            this.performanceMetrics.lastAdjustmentTime = now;
            this.logConnectionStats();
        }
    }

    async handleDisconnect(client: Socket) {
        this.logger.log(`[WS] Client disconnected from token namespace: ${client.id}`);
        this.cleanupClientSubscriptions(client.id);
        this.logConnectionStats();
    }

    private async fetchAndSendTokens(client: Socket, params: any) {
        const startTime = Date.now();
        try {
            const subscription = this.clientSubscriptions.get(client.id);
            if (!subscription) {
                this.logger.warn(`[WS] No subscription found for client ${client.id}`);
                return;
            }

            // Kiểm tra thời gian query trước đó
            const timeSinceLastQuery = Date.now() - subscription.lastQueryTime;
            if (timeSinceLastQuery < 1000) { // Tối thiểu 1 giây giữa các query
                this.logger.debug(`[WS] Skipping query for client ${client.id} - too frequent`);
                return;
            }

            // Nếu có dữ liệu cũ và chưa quá 3 giây, sử dụng dữ liệu cũ
            if (subscription.lastData && timeSinceLastQuery < 3000) {
                this.logger.debug(`[WS] Using cached data for client ${client.id}`);
                client.emit('tokenUpdate', {
                    event: 'tokenUpdate',
                    data: subscription.lastData,
                    metadata: {
                        timestamp: new Date(),
                        isFullUpdate: true,
                        isCached: true
                    }
                });
                return;
            }

            this.logger.debug(`[WS] Fetching new data for client ${client.id}`);
            const result = await this.fetchTokens(params);
            
            const queryTime = Date.now() - startTime;
            subscription.lastQueryTime = Date.now();
            subscription.queryCount++;
            subscription.lastData = result;

            // Log hiệu suất mỗi 10 query
            if (subscription.queryCount % 10 === 0) {
                this.logger.log(`[WS] Client ${client.id} performance - Query count: ${subscription.queryCount}, Last query time: ${queryTime}ms`);
            }

            if (!client.connected) {
                this.logger.warn(`[WS] Client ${client.id} disconnected during fetch`);
                this.cleanupClientSubscriptions(client.id);
                return;
            }

            client.emit('tokenUpdate', {
                event: 'tokenUpdate',
                data: result,
                metadata: {
                    timestamp: new Date(),
                    isFullUpdate: true,
                    isCached: false,
                    queryTime
                }
            });

        } catch (error) {
            this.logger.error(`[WS] Error fetching tokens for client ${client.id}:`, error);
            this.handleError(client, error, 'FETCH_ERROR');
        }
    }

    @SubscribeMessage('subscribeTokens')
    async handleSubscribeTokens(client: Socket, data: any) {
        try {
            if (!data || (data.page && (isNaN(data.page) || data.page < 1))) {
                throw new Error('Invalid subscription parameters');
            }

            this.logger.log(`[WS] Client ${client.id} subscribing to tokens with params:`, data);
            this.cleanupClientSubscriptions(client.id);

            // Gửi dữ liệu ngay lập tức khi subscribe, bắt đầu từ vị trí thứ 6
            const initialData = await this.fetchTokens({
                ...data,
                page: 1,
                limit: data.limit || 10,
                skip: 5  // Skip 5 để lấy từ vị trí thứ 6
            });

            client.emit('tokenUpdate', {
                event: 'tokenUpdate',
                data: initialData,
                metadata: {
                    timestamp: new Date(),
                    isFullUpdate: true,
                    isInitial: true
                }
            });

            // Thiết lập interval cập nhật
            const interval = setInterval(async () => {
                const updateStartTime = Date.now();
                try {
                    if (!client.connected) {
                        this.logger.warn(`[WS] Client ${client.id} disconnected during interval`);
                        this.cleanupClientSubscriptions(client.id);
                        return;
                    }

                    const subscription = this.clientSubscriptions.get(client.id);
                    if (!subscription) {
                        this.logger.warn(`[WS] No subscription found for client ${client.id} during interval`);
                        return;
                    }

                    const timeSinceLastUpdate = Date.now() - subscription.lastUpdateTime;
                    
                    if (timeSinceLastUpdate >= 3000) {
                        await this.fetchAndSendTokens(client, {
                            ...data,
                            page: 1,
                            limit: data.limit || 10,
                            skip: 5  // Skip 5 để lấy từ vị trí thứ 6
                        });
                        subscription.lastUpdateTime = Date.now();
                    }

                    const updateTime = Date.now() - updateStartTime;
                    if (updateTime > 1000) {
                        this.logger.warn(`[WS] Slow update for client ${client.id}: ${updateTime}ms`);
                    }

                } catch (error) {
                    this.logger.error(`[WS] Error in interval update for client ${client.id}:`, error);
                    this.cleanupClientSubscriptions(client.id);
                }
            }, 1000);

            this.clientSubscriptions.set(client.id, { 
                interval, 
                params: {
                    ...data,
                    page: 1,
                    limit: data.limit || 10,
                    skip: 5  // Skip 5 để lấy từ vị trí thứ 6
                },
                lastUpdateTime: Date.now(),
                lastQueryTime: Date.now(),
                queryCount: 0,
                lastData: initialData
            });
            this.logConnectionStats();

        } catch (error) {
            this.logger.error(`[WS] Error setting up subscription for client ${client.id}:`, error);
            this.handleError(client, error, 'SUBSCRIPTION_SETUP_ERROR');
            this.cleanupClientSubscriptions(client.id);
        }
    }

    @SubscribeMessage('unSubscribeTokens')
    async handleUnSubscribeTokens(client: Socket) {
        try {
            this.logger.log(`Client ${client.id} unsubscribing from tokens`);
            this.cleanupClientSubscriptions(client.id);
            client.emit('unSubscribeTokens', {
                event: 'unSubscribeTokens',
                data: { status: 200, message: 'Successfully unsubscribed from tokens' }
            });
        } catch (error) {
            this.logger.error(`Error unsubscribing from tokens: ${error.message}`);
            this.sendError(client, {
                event: 'error',
                data: { status: 500, message: 'Failed to unsubscribe from tokens' }
            });
        }
    }

    private sendError(client: Socket, error: { event: string; data: any }) {
        client.emit(error.event, error.data);
    }

    private adjustUpdateInterval() {
        if (this.performanceMetrics.queryTimes.length === 0) return;

        const avgQueryTime = this.performanceMetrics.queryTimes.reduce((sum, time) => sum + time, 0) /
            this.performanceMetrics.queryTimes.length;

        this.logger.log(`Average query time: ${avgQueryTime.toFixed(2)}ms, Current interval: ${this.currentUpdateInterval}ms`);

        if (avgQueryTime > this.performanceMetrics.performanceThreshold) {
            if (this.currentUpdateInterval < this.MAX_UPDATE_INTERVAL) {
                this.currentUpdateInterval = Math.min(this.currentUpdateInterval + 1000, this.MAX_UPDATE_INTERVAL);
                this.logger.log(`Performance poor, increasing interval to ${this.currentUpdateInterval}ms`);
            }
        } else {
            if (this.currentUpdateInterval > 2000) {
                this.currentUpdateInterval = Math.max(this.currentUpdateInterval - 1000, 2000);
                this.logger.log(`Performance good, decreasing interval to ${this.currentUpdateInterval}ms`);
            }
        }

        this.updateAllSubscriptions();
    }

    private updateAllSubscriptions() {
        for (const [clientId, subscription] of this.clientSubscriptions.entries()) {
            const adapterSockets = (this.server.sockets as any)?.sockets;
            const client = adapterSockets?.get?.(clientId);
            
            if (!client || !client.connected) {
                this.logger.debug(`Client ${clientId} not found or disconnected. Cleaning up subscription.`);
                this.cleanupClientSubscriptions(clientId);
                continue;
            }

            clearInterval(subscription.interval);

            const newInterval = setInterval(async () => {
                try {
                    if (!client.connected) {
                        this.logger.debug(`Client ${clientId} disconnected during update. Cleaning up subscription.`);
                        this.cleanupClientSubscriptions(clientId);
                        return;
                    }

                    const timeSinceLastUpdate = Date.now() - subscription.lastUpdateTime;
                    
                    if (timeSinceLastUpdate >= 3000) {
                        const startTime = Date.now();
                        const result = await this.fetchTokens(subscription.params);
                        const queryTime = Date.now() - startTime;

                        this.updatePerformanceMetrics(queryTime);
                        subscription.lastUpdateTime = Date.now();

                        client.emit('tokenUpdate', {
                            event: 'tokenUpdate',
                            data: result
                        });
                    }
                } catch (error) {
                    this.logger.error(`Error in subscription update: ${error.message}`);
                    this.eventEmitter.emit('websocket.error', {
                        type: 'subscription_error',
                        clientId,
                        timestamp: new Date(),
                        message: error.message,
                        stack: error.stack
                    });
                }
            }, 1000);

            this.clientSubscriptions.set(clientId, {
                interval: newInterval,
                params: subscription.params,
                lastUpdateTime: subscription.lastUpdateTime,
                lastQueryTime: Date.now(),
                queryCount: 0,
                lastData: null
            });
        }
    }

    private async fetchTokens(params: any) {
        try {
            const cacheKey = `tokens:${JSON.stringify(params)}`;
            
            // Try to get from cache first
            const cachedResult = await this.cacheService.get(cacheKey);
            if (cachedResult) {
                this.logger.debug(`[WS] Cache hit for key: ${cacheKey}`);
                return cachedResult;
            }

            this.logger.debug(`[WS] Cache miss for key: ${cacheKey}`);
            
            const conditions: any = {
                slt_name: Not(IsNull()),
                slt_symbol: Not(IsNull())
            };

            if (params?.verified !== undefined) {
                conditions.slt_is_verified = params.verified;
            }

            if (params?.token_address) {
                conditions.slt_address = params.token_address;
            }

            const total = await this.solanaTokenRepository.count({ where: conditions });
            
            const page = Math.max(1, params?.page || 1);
            const limit = Math.min(50, Math.max(1, params?.limit || 10));
            const skip = params?.skip || Math.max(0, (page - 1) * limit);

            const tokens = await this.solanaTokenRepository.find({
                where: conditions,
                order: { 
                    slt_updated_at: 'DESC',
                    slt_created_at: 'DESC' 
                },
                skip: skip,
                take: limit
            });

            // Process tokens
            const processedTokens = tokens.map(token => {
                // Validate and process logo URL
                if (token.slt_logo_url) {
                    try {
                        const url = new URL(token.slt_logo_url);
                        if (url.protocol === 'http:') {
                            token.slt_logo_url = token.slt_logo_url.replace('http:', 'https:');
                        }
                        if (!url.searchParams.has('_cb')) {
                            token.slt_logo_url = `${token.slt_logo_url}${url.search ? '&' : '?'}_cb=${Date.now()}`;
                        }
                    } catch (error) {
                        this.logger.warn(`Invalid logo URL for token ${token.slt_address}: ${token.slt_logo_url}`);
                        token.slt_logo_url = null;
                    }
                }

                return token;
            });

            const result = { 
                tokens: processedTokens, 
                total,
                metadata: {
                    page,
                    limit,
                    skip,
                    timestamp: new Date(),
                    hasLogos: processedTokens.some(token => token.slt_logo_url !== null)
                }
            };

            // Save to cache with TTL
            await this.cacheService.set(cacheKey, result, this.CACHE_TTL);
            
            return result;

        } catch (error) {
            this.logger.error(`[WS] Error fetching tokens:`, error);
            throw error;
        }
    }

    private cleanupClientSubscriptions(clientId: string) {
        const subscription = this.clientSubscriptions.get(clientId);
        if (subscription) {
            clearInterval(subscription.interval);
            this.clientSubscriptions.delete(clientId);
            this.logger.log(`[WS] Cleaned up subscriptions for client ${clientId}`);
        }
    }
} 