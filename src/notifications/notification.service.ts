import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { TradingOrder } from 'src/trade/entities/trading-order.entity';

@Injectable()
export class NotificationService {
    private telegramBotToken: string;
    private discordWebhook: string;

    constructor(private configService: ConfigService) {
        this.telegramBotToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN') || '';
        this.discordWebhook = this.configService.get<string>('DISCORD_WEBHOOK_URL') || '';
    }

    async sendTelegramMessage(chatId: string, message: string) {
        try {
            const url = `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`;
            await axios.post(url, {
                chat_id: chatId,
                text: message,
                parse_mode: 'HTML'
            });
        } catch (error) {
            console.error('Error sending Telegram message:', error);
        }
    }

    async sendDiscordMessage(message: string) {
        try {
            await axios.post(this.discordWebhook, {
                content: message
            });
        } catch (error) {
            console.error('Error sending Discord message:', error);
        }
    }

    async notifyNewTransaction(transactionDetail: any) {
        const message = this.formatTransactionMessage(transactionDetail);

        // Gửi đến cả Telegram và Discord
        if (transactionDetail.telegram_chat_id) {
            await this.sendTelegramMessage(
                transactionDetail.telegram_chat_id,
                message
            );
        }

        await this.sendDiscordMessage(message);
    }

    async notifyNewOrder(order: TradingOrder) {
        const message = `New ${order.order_trade_type} order created:
        Token: ${order.order_token_name}
        Amount: ${order.order_qlty}
        Price: ${order.order_price}
        Type: ${order.order_type}`;

        if (order.wallet?.wallet_id) {
            await this.sendTelegramMessage(
                order.wallet.wallet_id.toString(),
                message
            );
        }

        await this.sendDiscordMessage(message);
    }

    private formatTransactionMessage(detail: any): string {
        return `
🔄 New Master Trading Transaction

Type: ${detail.mt_detail_type.toUpperCase()}
Token: ${detail.mt_detail_token_name}
Amount: ${detail.mt_detail_amount} SOL
Price: $${detail.mt_detail_price}
Total: $${detail.mt_detail_total_usd}
Status: ${detail.mt_detail_status.toUpperCase()}
${detail.mt_detail_hash ? `\nTx Hash: ${detail.mt_detail_hash}` : ''}
        `.trim();
    }

    async sendMasterTradeNotification(
        telegramId: string,
        tradeInfo: {
            type: 'buy' | 'sell',
            token: string,
            amount: number,
            price: number,
            total: number,
            txHash: string
        }
    ) {
        try {
            const message = `Master Trade ${tradeInfo.type.toUpperCase()}: ${tradeInfo.amount} ${tradeInfo.token} at ${tradeInfo.price} SOL (Total: ${tradeInfo.total} SOL)`;

            await this.sendTelegramMessage(telegramId, message);
            await this.sendDiscordMessage(message);

            return true;
        } catch (error) {
            console.error('Error sending master trade notification:', error);
            return false;
        }
    }
} 