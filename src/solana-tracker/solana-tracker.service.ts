import { Injectable, OnModuleInit, Logger } from "@nestjs/common";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CopyTradeService } from "../copy-trade/copy-trade.service";
import { ConfigService } from "@nestjs/config";
import { CacheService } from '../cache/cache.service';
import { SolanaService } from "../solana/solana.service";
import { Inject } from "@nestjs/common";
import { SolanaTrackingService } from "../solana/services/tracking.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { SolanaWebSocketService } from "../solana/solana-websocket.service";

@Injectable()
export class SolanaTrackerService implements OnModuleInit {
    private readonly logger = new Logger(SolanaTrackerService.name);
    private lastProcessedTime = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
    private trackingWallets = new Set<string>();

    constructor(
        private readonly copyTradeService: CopyTradeService,
        private readonly configService: ConfigService,
        private readonly cacheService: CacheService,
        private readonly solanaService: SolanaService,
        private readonly solanaTrackingService: SolanaTrackingService,
        private readonly eventEmitter: EventEmitter2,
        @Inject('SOLANA_CONNECTION')
        private readonly connection: Connection,
        private readonly solanaWebSocketService: SolanaWebSocketService
    ) {
        this.eventEmitter.on('wallet.transaction', async (data) => {
            await this.handleTransaction(data);
        });
    }

    async onModuleInit() {
        console.log("🚀 Solana Copy Trade Tracker is running...");

        // Khởi động theo dõi
        this.startTracking();
    }

    // Khởi động theo dõi qua WebSocket
    private async startTracking() {
        try {
            const walletMap = await this.getTrackingWalletsByTelegram();

            // Đăng ký theo dõi tất cả các ví
            for (const telegramWallet in walletMap) {
                const walletData = walletMap[telegramWallet];

                for (const { trackingWallet, privateKey } of walletData) {
                    try {
                        // Thêm vào danh sách theo dõi
                        this.trackingWallets.add(trackingWallet);

                        // Đăng ký theo dõi qua WebSocket
                        await this.solanaTrackingService.trackTransactions(
                            trackingWallet,
                            'copy-trade'
                        );

                        console.log(`🔔 Started tracking wallet: ${trackingWallet}`);
                    } catch (error) {
                        console.error(`⚠️ Error tracking wallet ${trackingWallet}:`, error.message);
                    }
                }
            }
        } catch (error) {
            console.error("❌ Error starting tracking:", error.message);
        }
    }

    // Xử lý giao dịch từ hash
    private async processCopyTradeByHash(trackingWallet: string, txHash: string) {
        try {
            // Check if already processed
            const isProcessed = await this.copyTradeService.isTransactionProcessed(txHash);
            if (isProcessed) {
                console.log(`⚠️ Transaction already processed: ${txHash}`);
                return;
            }

            // Tìm thông tin telegram wallet và private key
            const walletMap = await this.getTrackingWalletsByTelegram();
            let telegramWallet = '';
            let privateKey = '';

            for (const tgWallet in walletMap) {
                const walletData = walletMap[tgWallet];
                const found = walletData.find(w => w.trackingWallet === trackingWallet);

                if (found) {
                    telegramWallet = tgWallet;
                    privateKey = found.privateKey;
                    break;
                }
            }

            if (!telegramWallet || !privateKey) {
                console.log(`⚠️ Could not find telegram wallet for tracking wallet: ${trackingWallet}`);
                return;
            }

            // Lấy transaction details từ hash
            const txDetails = await this.connection.getParsedTransaction(txHash, {
                maxSupportedTransactionVersion: 0
            });

            // Phân tích giao dịch để lấy token addresses
            const { inputMint, outputMint } = await this.solanaService.analyzeTransaction(txHash);

            // Xác định loại giao dịch (buy/sell)
            const transactionType = inputMint === "So11111111111111111111111111111111111111112"
                ? 'buy' : 'sell';

            if (transactionType === 'buy') {
                // Copy lệnh mua như bình thường
                const detail = await this.copyTradeService.createCopyTradeDetail({
                    ct_traking_hash: txHash,
                    ct_detail_status: 'wait',
                    ct_detail_time: new Date(),
                    ct_type: 'buy'
                });
                await this.copyTradeService.executeCopyTrade({
                    telegramWallet,
                    trackingWallet,
                    privateKey,
                    transaction: txDetails,
                    detail,
                    inputMint,
                    outputMint
                });

                // Lưu vào position_tracking nếu ct_sell_method là auto hoặc manual
                const copyTrade = await this.copyTradeService.getCopyTrade(trackingWallet);
                if (copyTrade && ['auto', 'manual'].includes(copyTrade.ct_sell_method)) {
                    // Lấy giá và số lượng từ detail
                    const currentPrice = detail.ct_detail_price;
                    const tradeAmount = detail.ct_detail_amount;

                    await this.copyTradeService.createPositionTracking({
                        ct_trade: copyTrade,
                        pt_token_address: outputMint,
                        pt_entry_price: currentPrice,
                        pt_amount: tradeAmount,
                        pt_status: 'open'
                    });
                }
            } else {
                // Khi là lệnh bán, kiểm tra position_tracking
                const positions = await this.copyTradeService.getOpenPositions(trackingWallet, outputMint);

                for (const position of positions) {
                    if (position.ct_trade.ct_sell_method === 'auto') {
                        // Tự động bán với tỉ lệ tương ứng
                        await this.copyTradeService.executeSellOrder(position, 'proportional');
                    } else if (position.ct_trade.ct_sell_method === 'manual') {
                        // Check điều kiện TP/SL
                        const currentPrice = await this.solanaService.getTokenPrice(outputMint);
                        const shouldSell = this.copyTradeService.checkTPSL(
                            position,
                            currentPrice,
                            position.ct_trade.ct_tp,
                            position.ct_trade.ct_sl
                        );

                        if (shouldSell) {
                            // Bán toàn bộ vị thế
                            await this.copyTradeService.executeSellOrder(position, 'full');
                        }
                    }
                }
            }

        } catch (error) {
            console.error('Error processing copy trade:', error);
        }
    }

    // Giữ lại các phương thức cũ để đảm bảo tính tương thích
    async getTrackingWalletsByTelegram(): Promise<Record<string, { trackingWallet: string, privateKey: string }[]>> {
        const activeTrades = await this.copyTradeService.getActiveTrackingWallets();

        const walletMap: Record<string, { trackingWallet: string, privateKey: string }[]> = {};

        activeTrades.forEach(trade => {
            // Thêm điều kiện kiểm tra ct_amount
            if (trade.ct_amount <= 0.001) {
                console.log(`⚠️ Skipping wallet ${trade.ct_tracking_wallet} due to insufficient ct_amount: ${trade.ct_amount}`);
                return; // Skip this iteration
            }

            const telegramWallet = trade.ct_wallet.wallet_id.toString();
            const trackingWallet = trade.ct_tracking_wallet;
            const privateKeyObject = JSON.parse(trade.ct_wallet.wallet_private_key);
            const privateKey = privateKeyObject?.solana; // 🌟 Lấy private key của Solana

            if (!walletMap[telegramWallet]) {
                walletMap[telegramWallet] = [];
            }

            // ✅ Thêm object chứa cả trackingWallet và privateKey
            if (!walletMap[telegramWallet].some(item => item.trackingWallet === trackingWallet)) {
                walletMap[telegramWallet].push({ trackingWallet, privateKey });
            }
        });

        console.log("🔍 Telegram Wallets with Tracking Wallets and Private Keys:", walletMap);
        return walletMap;
    }

    private async getTransactionsWithRetry(address: PublicKey, retries = 5, delay = 2000): Promise<any[]> {
        // Check cache first
        const cacheKey = `transactions:${address.toString()}`;
        const cachedTxs = await this.cacheService.get(cacheKey);
        if (cachedTxs) {
            return cachedTxs;
        }

        // Get excluded hashes first
        const excludedHashes = await this.copyTradeService.getExcludedHashes();

        for (let i = 0; i < retries; i++) {
            try {
                const transactions = await this.connection.getSignaturesForAddress(address, { limit: 5 });

                // Filter out excluded transactions
                const filteredTxs = transactions.filter(tx =>
                    !excludedHashes.includes(tx.signature)
                );

                // Cache filtered results
                await this.cacheService.set(cacheKey, filteredTxs, 30);
                return filteredTxs;
            } catch (error) {
                if (error.message?.includes('429')) {
                    // Exponential backoff for rate limits
                    const backoffDelay = delay * Math.pow(2, i);
                    console.log(`Rate limit hit, waiting ${backoffDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, backoffDelay));
                    continue;
                }

                if (i === retries - 1) {
                    console.log(`❌ All retries failed for ${address.toString()}`);
                    return [];
                }

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        return [];
    }

    private async processCopyTrade(telegramWallet: string, trackingWallet: string, privateKey: string, transaction: any, txHash: string) {
        try {
            // Check if already processed
            const isProcessed = await this.copyTradeService.isTransactionProcessed(txHash);
            if (isProcessed) {
                console.log(`⚠️ Transaction already processed: ${txHash}`);
                return;
            }

            // Lấy transaction details từ hash
            const txDetails = await this.connection.getParsedTransaction(txHash, {
                maxSupportedTransactionVersion: 0
            });

            // Phân tích giao dịch để lấy token addresses
            const { inputMint, outputMint } = await this.solanaService.analyzeTransaction(txHash);

            // Xác định loại giao dịch (buy/sell)
            const transactionType = inputMint === "So11111111111111111111111111111111111111112"
                ? 'buy' : 'sell';

            if (transactionType === 'buy') {
                // Copy lệnh mua như bình thường
                const detail = await this.copyTradeService.createCopyTradeDetail({
                    ct_traking_hash: txHash,
                    ct_detail_status: 'wait',
                    ct_detail_time: new Date(),
                    ct_type: 'buy'
                });
                await this.copyTradeService.executeCopyTrade({
                    telegramWallet,
                    trackingWallet,
                    privateKey,
                    transaction: txDetails,
                    detail,
                    inputMint,
                    outputMint
                });

                // Lưu vào position_tracking nếu ct_sell_method là auto hoặc manual
                const copyTrade = await this.copyTradeService.getCopyTrade(trackingWallet);
                if (copyTrade && ['auto', 'manual'].includes(copyTrade.ct_sell_method)) {
                    // Lấy giá và số lượng từ detail
                    const currentPrice = detail.ct_detail_price;
                    const tradeAmount = detail.ct_detail_amount;

                    await this.copyTradeService.createPositionTracking({
                        ct_trade: copyTrade,
                        pt_token_address: outputMint,
                        pt_entry_price: currentPrice,
                        pt_amount: tradeAmount,
                        pt_status: 'open'
                    });
                }
            } else {
                // Khi là lệnh bán, kiểm tra position_tracking
                const positions = await this.copyTradeService.getOpenPositions(trackingWallet, outputMint);

                for (const position of positions) {
                    if (position.ct_trade.ct_sell_method === 'auto') {
                        // Tự động bán với tỉ lệ tương ứng
                        await this.copyTradeService.executeSellOrder(position, 'proportional');
                    } else if (position.ct_trade.ct_sell_method === 'manual') {
                        // Check điều kiện TP/SL
                        const currentPrice = await this.solanaService.getTokenPrice(outputMint);
                        const shouldSell = this.copyTradeService.checkTPSL(
                            position,
                            currentPrice,
                            position.ct_trade.ct_tp,
                            position.ct_trade.ct_sl
                        );

                        if (shouldSell) {
                            // Bán toàn bộ vị thế
                            await this.copyTradeService.executeSellOrder(position, 'full');
                        }
                    }
                }
            }

        } catch (error) {
            console.error('Error processing copy trade:', error);
        }
    }

    private async handleTransaction(data: any) {
        try {
            const { address, signature } = data;

            this.logger.debug('Received transaction:', { address, signature });

            // Kiểm tra xem có phải ví đang theo dõi không
            if (this.trackingWallets.has(address)) {
                await this.processCopyTradeByHash(address, signature);
            }
        } catch (error) {
            this.logger.error('Error processing transaction:', error);
        }
    }
}
