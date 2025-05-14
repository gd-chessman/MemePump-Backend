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
        // Tạo Map để theo dõi số lượng tab của mỗi người dùng
        const userTabs = new Map<string, number>();
        const userRoles = new Map<string, {
            walletAuth: string
        }>();

        for (const wallet of this.connectedWallets.values()) {
            const userKey = `${wallet.ip}-${wallet.device.browser}-${wallet.device.os}-${wallet.device.device}`;
            userTabs.set(userKey, (userTabs.get(userKey) || 0) + 1);
            
            // Lưu role của người dùng (lấy từ kết nối đầu tiên)
            if (!userRoles.has(userKey)) {
                userRoles.set(userKey, {
                    walletAuth: wallet.walletAuth
                });
            }
        }

        const stats = {
            total: userTabs.size, // Số lượng người dùng thực sự
            master: 0,
            member: 0,
            anonymous: 0,
            userTabs: {} as Record<string, {
                tabsCount: number,
                walletAuth: string,
                device: {
                    browser: string,
                    os: string,
                    device: string
                },
                ip: string,
                lastActive: number,
                connections: Array<{
                    clientId: string,
                    walletId: number,
                    lastActive: number
                }>
            }>,
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
                device: data.device,
                ip: data.ip,
                lastActive: data.lastActive,
                tabsCount: userTabs.get(`${data.ip}-${data.device.browser}-${data.device.os}-${data.device.device}`) || 1
            }))
        };

        // Đếm số lượng người dùng thực sự cho mỗi role
        for (const [userKey, roles] of userRoles.entries()) {
            const tabCount = userTabs.get(userKey) || 1;
            const [ip, browser, os, device] = userKey.split('-');
            
            // Tìm tất cả các kết nối của người dùng này
            const userConnections = Array.from(this.connectedWallets.entries())
                .filter(([_, data]) => 
                    data.ip === ip && 
                    data.device.browser === browser && 
                    data.device.os === os && 
                    data.device.device === device
                )
                .map(([clientId, data]) => ({
                    clientId,
                    walletId: data.walletId,
                    lastActive: data.lastActive
                }));

            stats.userTabs[userKey] = {
                tabsCount: tabCount,
                walletAuth: roles.walletAuth,
                device: {
                    browser,
                    os,
                    device
                },
                ip,
                lastActive: Math.max(...userConnections.map(conn => conn.lastActive)),
                connections: userConnections
            };
            
            if (roles.walletAuth === 'guest') {
                stats.anonymous++;
            } else {
                if (roles.walletAuth === 'master') stats.master++;
                if (roles.walletAuth === 'member') stats.member++;
            }

            // Đếm thiết bị dựa trên người dùng thực sự
            stats.devices.browsers[browser] = (stats.devices.browsers[browser] || 0) + 1;
            stats.devices.os[os] = (stats.devices.os[os] || 0) + 1;
            stats.devices.deviceTypes[device] = (stats.devices.deviceTypes[device] || 0) + 1;
            stats.ips[ip] = (stats.ips[ip] || 0) + 1;
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