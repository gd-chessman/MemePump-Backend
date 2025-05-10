import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { WsJwtAuthGuard } from '../auth/guards/ws-jwt-auth.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';

@WebSocketGateway({
    cors: {
        origin: '*',
    },
})
export class AdminGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(AdminGateway.name);
    private connectedWallets = new Map<string, {
        walletId: number,
        walletAuth: string,
        walletStream: string,
        lastActive: number
    }>();

    constructor(
        @InjectRepository(ListWallet)
        private listWalletRepository: Repository<ListWallet>
    ) {
        // Cleanup inactive connections every minute
        setInterval(() => this.cleanupInactiveConnections(), 60000);
    }

    async handleConnection(client: Socket) {
        try {
            const walletId = client.handshake.query.walletId as string;
            if (!walletId) {
                client.disconnect();
                return;
            }

            const wallet = await this.listWalletRepository.findOne({
                where: { wallet_id: parseInt(walletId) }
            });

            if (!wallet) {
                client.disconnect();
                return;
            }

            this.connectedWallets.set(client.id, {
                walletId: wallet.wallet_id,
                walletAuth: wallet.wallet_auth,
                walletStream: wallet.wallet_stream,
                lastActive: Date.now()
            });

            this.broadcastOnlineStats();
            this.logger.log(`Wallet ${walletId} connected`);
        } catch (error) {
            this.logger.error('Connection error:', error);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        this.connectedWallets.delete(client.id);
        this.broadcastOnlineStats();
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    @SubscribeMessage('heartbeat')
    handleHeartbeat(client: Socket) {
        const wallet = this.connectedWallets.get(client.id);
        if (wallet) {
            wallet.lastActive = Date.now();
            this.connectedWallets.set(client.id, wallet);
        }
    }

    @SubscribeMessage('getOnlineStats')
    handleGetOnlineStats() {
        return this.getOnlineStats();
    }

    private getOnlineStats() {
        const stats = {
            total: this.connectedWallets.size,
            master: 0,
            member: 0,
            vip: 0,
            normal: 0
        };

        for (const wallet of this.connectedWallets.values()) {
            if (wallet.walletAuth === 'master') stats.master++;
            if (wallet.walletAuth === 'member') stats.member++;
            if (wallet.walletStream === 'vip') stats.vip++;
            if (wallet.walletStream === 'normal') stats.normal++;
        }

        return stats;
    }

    private broadcastOnlineStats() {
        const stats = this.getOnlineStats();
        this.server.emit('onlineStats', stats);
    }

    private cleanupInactiveConnections() {
        const now = Date.now();
        const inactiveThreshold = 60000; // 1 minute

        for (const [clientId, wallet] of this.connectedWallets.entries()) {
            if (now - wallet.lastActive > inactiveThreshold) {
                this.connectedWallets.delete(clientId);
                this.logger.log(`Removed inactive connection: ${clientId}`);
            }
        }

        this.broadcastOnlineStats();
    }
} 