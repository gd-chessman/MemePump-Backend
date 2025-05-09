import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BirdeyeWebSocket } from './hooks/use-birdeye-websocket';

@WebSocketGateway({
    namespace: 'token-info',
    transports: ['websocket'],
    path: '/socket.io',
    allowEIO3: true,
    allowEIO4: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 60000
})
export class TokenInfoGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;
    private readonly logger = new Logger(TokenInfoGateway.name);
    private birdeyeWs: BirdeyeWebSocket;
    private tokenSubscriptions: Map<string, Set<string>> = new Map(); // Map<tokenAddress, Set<clientId>>
    private clientSubscriptions: Map<string, Set<string>> = new Map(); // Map<clientId, Set<tokenAddress>>
    private pendingSubscriptions: Set<string> = new Set(); // Track tokens waiting to be subscribed

    constructor(private readonly configService: ConfigService) {
        this.birdeyeWs = new BirdeyeWebSocket(
            this.configService,
            TokenInfoGateway.name,
            {
                onOpen: () => {
                    this.logger.log('Birdeye WebSocket connected');
                    // Resubscribe to all pending tokens when reconnected
                    this.pendingSubscriptions.forEach(tokenAddress => {
                        this.subscribeToBirdeye(tokenAddress);
                    });
                },
                onMessage: (message) => this.handleBirdeyeMessage(message),
                onError: (error) => this.logger.error('Birdeye WebSocket error:', error),
                onClose: () => this.logger.warn('Birdeye WebSocket closed')
            }
        );
    }

    afterInit(server: Server) {
        this.logger.log('TokenInfoGateway initialized');
        this.server = server;
        this.birdeyeWs.connect();
    }

    handleConnection(client: Socket) {
        this.logger.log(`👤 Client connected: ${client.id}`);
        this.clientSubscriptions.set(client.id, new Set());
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`👋 Client disconnected: ${client.id}`);
        const subscribedTokens = this.clientSubscriptions.get(client.id);
        if (subscribedTokens) {
            subscribedTokens.forEach(tokenAddress => {
                this.unsubscribeFromToken(client, tokenAddress);
            });
        }
        this.clientSubscriptions.delete(client.id);
    }

    @SubscribeMessage('subscribe')
    async handleSubscribe(client: Socket, data: { tokenAddress: string }) {
        try {
            const { tokenAddress } = data;
            if (!tokenAddress) {
                this.logger.error(`❌ Client ${client.id} tried to subscribe without token address`);
                this.handleError(client, 'Token address is required', 'SUBSCRIBE_ERROR');
                return;
            }

            this.logger.log(`📌 Client ${client.id} subscribing to ${tokenAddress}`);
            this.subscribeToToken(tokenAddress, client.id);
            client.emit('subscribed', { tokenAddress });
        } catch (error) {
            this.logger.error(`❌ Error subscribing client ${client.id} to token: ${error.message}`);
            this.handleError(client, error.message, 'SUBSCRIBE_ERROR');
        }
    }

    @SubscribeMessage('unsubscribe')
    async handleUnsubscribe(client: Socket, data: { tokenAddress: string }) {
        try {
            const { tokenAddress } = data;
            if (!tokenAddress) {
                this.logger.error(`❌ Client ${client.id} tried to unsubscribe without token address`);
                this.handleError(client, 'Token address is required', 'UNSUBSCRIBE_ERROR');
                return;
            }

            this.logger.log(`❌ Client ${client.id} unsubscribing from ${tokenAddress}`);
            this.unsubscribeFromToken(client, tokenAddress);
            client.emit('unsubscribed', { tokenAddress });
        } catch (error) {
            this.logger.error(`❌ Error unsubscribing client ${client.id} from token: ${error.message}`);
            this.handleError(client, error.message, 'UNSUBSCRIBE_ERROR');
        }
    }

    private handleError(client: Socket, message: string, context: string) {
        this.logger.error(`[${context}] Error for client ${client.id}: ${message}`);
        client.emit('error', { 
            context,
            message,
            timestamp: new Date()
        });
    }

    private subscribeToToken(tokenAddress: string, clientId: string) {
        try {
            if (!this.tokenSubscriptions.has(tokenAddress)) {
                this.tokenSubscriptions.set(tokenAddress, new Set());
            }
            this.tokenSubscriptions.get(tokenAddress)!.add(clientId);
            this.clientSubscriptions.get(clientId)!.add(tokenAddress);

            if (this.tokenSubscriptions.get(tokenAddress)!.size === 1) {
                this.pendingSubscriptions.add(tokenAddress);
                this.subscribeToBirdeye(tokenAddress);
            }
        } catch (error) {
            this.logger.error(`Error subscribing to token ${tokenAddress}:`, error);
        }
    }

    private unsubscribeFromToken(client: Socket, tokenAddress: string) {
        try {
            if (this.tokenSubscriptions.has(tokenAddress)) {
                const subscribers = this.tokenSubscriptions.get(tokenAddress)!;
                subscribers.delete(client.id);
                this.clientSubscriptions.get(client.id)!.delete(tokenAddress);

                if (subscribers.size === 0) {
                    this.tokenSubscriptions.delete(tokenAddress);
                    this.pendingSubscriptions.delete(tokenAddress);
                    this.unsubscribeFromBirdeye(tokenAddress);
                }
            }
        } catch (error) {
            this.logger.error(`Error unsubscribing from token ${tokenAddress}:`, error);
        }
    }

    private subscribeToBirdeye(tokenAddress: string) {
        try {
            const subscribeMessage = {
                type: 'SUBSCRIBE_PRICE',
                data: {
                    queryType: 'simple',
                    chartType: '1m',
                    address: tokenAddress,
                    currency: 'usd'
                }
            };
            this.birdeyeWs.send(subscribeMessage);
        } catch (error) {
            this.logger.error(`❌ Error subscribing to token: ${error.message}`);
        }
    }

    private unsubscribeFromBirdeye(tokenAddress: string) {
        try {
            if (this.birdeyeWs.isConnected()) {
                const unsubscribeMessage = {
                    type: 'UNSUBSCRIBE_PRICE',
                    data: {
                        queryType: 'simple',
                        chartType: '1m',
                        address: tokenAddress,
                        currency: 'usd'
                    }
                };
                this.birdeyeWs.send(unsubscribeMessage);
            }
        } catch (error) {
            this.logger.error(`Error unsubscribing from Birdeye for ${tokenAddress}:`, error);
        }
    }

    private handleBirdeyeMessage(message: any) {
        try {
            if (message.type === 'PRICE_DATA' && message.data?.eventType === 'ohlcv') {
                const { address, c, symbol } = message.data;
                if (address && typeof c === 'number') {
                    const subscribers = this.tokenSubscriptions.get(address);
                    if (subscribers) {
                        subscribers.forEach(clientId => {
                            this.server.to(clientId).emit('price', { 
                                tokenAddress: address,
                                symbol,
                                price: c,
                                timestamp: Date.now()
                            });
                        });
                    }
                }
            } else if (message.type === 'ERROR') {
                this.logger.error(`❌ Error from Birdeye: ${JSON.stringify(message)}`);
            }
        } catch (error) {
            this.logger.error(`❌ Error handling message: ${error.message}`);
        }
    }
}