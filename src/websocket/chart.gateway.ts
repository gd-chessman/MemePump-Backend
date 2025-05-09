import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { OnChainService } from '../on-chain/on-chain.service';
import { BirdeyeService, Timeframe } from '../on-chain/birdeye.service';
import { CacheService } from '../cache/cache.service';
import { SolanaWebSocketService } from '../solana/solana-websocket.service';
import { PublicKey } from '@solana/web3.js';
import { ConfigService } from '@nestjs/config';
import { BirdeyeWebSocket } from './hooks/use-birdeye-websocket';

@WebSocketGateway({
    namespace: 'chart',
    transports: ['websocket'],
    path: '/socket.io',
    allowEIO3: true,
    allowEIO4: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 60000
})
export class ChartGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(ChartGateway.name);
    private clientSubscriptions: Map<string, Set<string>> = new Map();
    private clientTimeframes: Map<string, Timeframe> = new Map();
    private readonly CACHE_TTL = 300; // 5 minutes
    private birdeyeWsMap: Map<string, BirdeyeWebSocket> = new Map();
    private readonly DEFAULT_TIMEFRAME: Timeframe = '5m';
    private readonly SUPPORTED_TIMEFRAMES: Timeframe[] = ['1s', '5s', '30s', '1m', '5m', '15m', '1h', '4h', '1d'];

    constructor(
        private readonly onChainService: OnChainService,
        private readonly birdeyeService: BirdeyeService,
        private readonly cacheService: CacheService,
        private readonly solanaWebSocketService: SolanaWebSocketService,
        private readonly configService: ConfigService
    ) { }

    handleConnection(client: Socket) {
        this.logger.log(`Client connected to chart namespace: ${client.id}`);
        client.emit('connected', { clientId: client.id });
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected from chart namespace: ${client.id}`);
        // Clean up subscriptions
        const subscriptions = this.clientSubscriptions.get(client.id);
        if (subscriptions) {
            subscriptions.forEach(tokenAddress => {
                const subscribers = this.clientSubscriptions.get(tokenAddress);
                if (subscribers) {
                    subscribers.delete(client.id);
                    if (subscribers.size === 0) {
                        const ws = this.birdeyeWsMap.get(tokenAddress);
                        if (ws) {
                            ws.disconnect();
                            this.birdeyeWsMap.delete(tokenAddress);
                        }
                        this.clientSubscriptions.delete(tokenAddress);
                    }
                }
            });
            this.clientSubscriptions.delete(client.id);
        }
        this.clientTimeframes.delete(client.id);
    }

    private initializeBirdeyeWebSocket(tokenAddress: string, timeframe: Timeframe = '5m') {
        if (this.birdeyeWsMap.has(tokenAddress)) {
            this.logger.debug(`WebSocket already exists for ${tokenAddress}`);
            return;
        }

        this.logger.log(`Initializing WebSocket for ${tokenAddress} with timeframe ${timeframe}`);
        
        const birdeyeWs = new BirdeyeWebSocket(
            this.configService,
            ChartGateway.name,
            {
                onOpen: () => {
                    this.logger.log(`WebSocket connected for ${tokenAddress}`);
                    const subscribeMessage = {
                        type: "SUBSCRIBE_PRICE",
                        data: {
                            queryType: "simple",
                            chartType: timeframe,
                            address: tokenAddress,
                            currency: "usd"
                        }
                    };
                    birdeyeWs.send(subscribeMessage);
                },
                onMessage: (message) => {
                    if (message.type === 'PRICE_DATA' && message.data?.eventType === 'ohlcv') {
                        const subscribers = this.clientSubscriptions.get(tokenAddress);
                        if (subscribers) {
                            subscribers.forEach(clientId => {
                                const clientTimeframe = this.clientTimeframes.get(clientId);
                                if (clientTimeframe === timeframe) {
                                    this.server.to(clientId).emit('chartUpdate', {
                                        tokenAddress,
                                        timeframe,
                                        timestamp: Date.now(),
                                        data: {
                                            time: Math.floor(Date.now() / 1000),
                                            open: message.data.o,
                                            high: message.data.h,
                                            low: message.data.l,
                                            close: message.data.c,
                                            volume: message.data.v,
                                            symbol: message.data.symbol,
                                            unixTime: message.data.unixTime,
                                            type: message.data.type
                                        }
                                    });
                                }
                            });
                        }
                    }
                },
                onError: (error) => {
                    this.logger.error(`WebSocket error for ${tokenAddress}:`, error);
                },
                onClose: () => {
                    this.logger.warn(`WebSocket closed for ${tokenAddress}`);
                    this.birdeyeWsMap.delete(tokenAddress);
                    if (this.hasActiveSubscribers(tokenAddress)) {
                        setTimeout(() => {
                            this.initializeBirdeyeWebSocket(tokenAddress, timeframe);
                        }, 5000);
                    }
                }
            }
        );

        this.birdeyeWsMap.set(tokenAddress, birdeyeWs);
        birdeyeWs.connect();
    }

    private hasActiveSubscribers(tokenAddress: string): boolean {
        const subscribers = this.clientSubscriptions.get(tokenAddress);
        return subscribers !== undefined && subscribers.size > 0;
    }

    @SubscribeMessage('subscribeToChart')
    async handleSubscribeToChart(client: Socket, data: { tokenAddress: string, timeframe?: Timeframe }) {
        try {
            this.logger.log(`Client ${client.id} subscribing to chart with data:`, data);

            const { tokenAddress, timeframe = this.DEFAULT_TIMEFRAME } = data;

            if (!tokenAddress) {
                throw new Error('Token address is required');
            }

            if (!this.SUPPORTED_TIMEFRAMES.includes(timeframe)) {
                throw new Error(`Unsupported timeframe. Supported timeframes: ${this.SUPPORTED_TIMEFRAMES.join(', ')}`);
            }

            // Track client's subscription and timeframe
            if (!this.clientSubscriptions.has(tokenAddress)) {
                this.clientSubscriptions.set(tokenAddress, new Set());
            }
            this.clientSubscriptions.get(tokenAddress)?.add(client.id);
            this.clientTimeframes.set(client.id, timeframe);

            // Initialize Birdeye WebSocket
            this.initializeBirdeyeWebSocket(tokenAddress, timeframe);

            // Send success response
            client.emit('subscriptionSuccess', {
                success: true,
                message: 'Successfully subscribed to chart',
                data: {
                    tokenAddress,
                    timeframe
                }
            });

        } catch (error) {
            this.logger.error(`Error subscribing to chart for ${data.tokenAddress}:`, error);
            client.emit('subscriptionError', {
                success: false,
                message: error.message || 'Failed to subscribe to chart',
                details: error
            });
        }
    }

    @SubscribeMessage('unsubscribeFromChart')
    async handleUnsubscribeFromChart(client: Socket, data: { tokenAddress: string }) {
        try {
            const { tokenAddress } = data;
            this.logger.log(`Client ${client.id} unsubscribing from chart: ${tokenAddress}`);

            // Remove from client's subscriptions
            const subscriptions = this.clientSubscriptions.get(tokenAddress);
            if (subscriptions) {
                subscriptions.delete(client.id);
                
                // If no more subscribers, close WebSocket connection
                if (subscriptions.size === 0) {
                    const ws = this.birdeyeWsMap.get(tokenAddress);
                    if (ws) {
                        ws.disconnect();
                        this.birdeyeWsMap.delete(tokenAddress);
                    }
                    this.clientSubscriptions.delete(tokenAddress);
                }
            }

            client.emit('unsubscriptionSuccess', {
                success: true,
                message: 'Successfully unsubscribed from chart',
                data: { tokenAddress }
            });

        } catch (error) {
            this.logger.error(`Error unsubscribing from chart: ${error.message}`);
            client.emit('error', { 
                success: false,
                message: 'Failed to unsubscribe from chart',
                details: error
            });
        }
    }
} 