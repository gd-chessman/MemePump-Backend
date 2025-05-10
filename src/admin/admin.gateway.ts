import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ListWallet } from '../telegram-wallets/entities/list-wallet.entity';
import * as UAParser from 'ua-parser-js';

@WebSocketGateway({
    cors: {
        origin: '*',
    },
    namespace: 'admin',
    transports: ['websocket', 'polling'],
    path: '/socket.io'
})
export class AdminGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(AdminGateway.name);
    private connectedWallets = new Map<string, {
        walletId: number,
        walletAuth: string,
        walletStream: string,
        lastActive: number,
        device: {
            browser: string,
            os: string,
            device: string
        },
        ip: string
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
            const userAgent = client.handshake.headers['user-agent'] || '';
            const ip = client.handshake.address;
            const parser = new UAParser.UAParser(userAgent);
            const deviceInfo = {
                browser: `${parser.getBrowser().name} ${parser.getBrowser().version}`,
                os: `${parser.getOS().name} ${parser.getOS().version}`,
                device: parser.getDevice().type || 'desktop'
            };
            
            // Nếu có walletId, kiểm tra và thêm vào room tương ứng
            if (walletId) {
                const wallet = await this.listWalletRepository.findOne({
                    where: { wallet_id: parseInt(walletId) }
                });

                if (wallet) {                 
                    this.connectedWallets.set(client.id, {
                        walletId: wallet.wallet_id,
                        walletAuth: wallet.wallet_auth,
                        walletStream: wallet.wallet_stream,
                        lastActive: Date.now(),
                        device: deviceInfo,
                        ip: ip
                    });
                }
            }

            // Tất cả client đều được thêm vào room all_clients
            client.join('all_clients');
            
            // Nếu không có walletId hoặc wallet không tồn tại, thêm vào với role guest
            if (!this.connectedWallets.has(client.id)) {
                this.connectedWallets.set(client.id, {
                    walletId: 0,
                    walletAuth: 'guest',
                    walletStream: 'normal',
                    lastActive: Date.now(),
                    device: deviceInfo,
                    ip: ip
                });
            }

            this.broadcastOnlineStats();
            this.logger.log(`Client connected: ${client.id}${walletId ? ` (Wallet: ${walletId})` : ''} - ${deviceInfo.browser} on ${deviceInfo.os} from ${ip}`);
        } catch (error) {
            this.logger.error('Connection error:', error);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        const wallet = this.connectedWallets.get(client.id);
        if (wallet) {
            // Leave rooms
            client.leave(`wallet_${wallet.walletAuth}`);
            client.leave(`stream_${wallet.walletStream}`);
        }
        
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
            normal: 0,
            devices: {
                browsers: {} as Record<string, number>,
                os: {} as Record<string, number>,
                deviceTypes: {} as Record<string, number>
            },
            ips: {} as Record<string, number>,
            connections: Array.from(this.connectedWallets.entries()).map(([clientId, data]) => ({
                clientId,
                walletId: data.walletId,
                walletAuth: data.walletAuth,
                walletStream: data.walletStream,
                device: data.device,
                ip: data.ip,
                lastActive: data.lastActive
            }))
        };

        // Đếm số lượng theo loại wallet
        for (const wallet of this.connectedWallets.values()) {
            if (wallet.walletAuth === 'master') stats.master++;
            if (wallet.walletAuth === 'member') stats.member++;
            if (wallet.walletStream === 'vip') stats.vip++;
            if (wallet.walletStream === 'normal') stats.normal++;

            // Thống kê thiết bị
            stats.devices.browsers[wallet.device.browser] = (stats.devices.browsers[wallet.device.browser] || 0) + 1;
            stats.devices.os[wallet.device.os] = (stats.devices.os[wallet.device.os] || 0) + 1;
            stats.devices.deviceTypes[wallet.device.device] = (stats.devices.deviceTypes[wallet.device.device] || 0) + 1;
            
            // Thống kê IP
            stats.ips[wallet.ip] = (stats.ips[wallet.ip] || 0) + 1;
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