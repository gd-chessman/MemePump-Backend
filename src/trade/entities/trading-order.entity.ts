import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ListWallet } from '../../telegram-wallets/entities/list-wallet.entity';

@Entity('trading_orders')
export class TradingOrder {
    @PrimaryGeneratedColumn()
    order_id: number;

    @Column()
    order_wallet_id: number;

    @Column({
        type: 'enum',
        enum: ['buy', 'sell']
    })
    order_trade_type: 'buy' | 'sell';

    @Column()
    order_token_address: string;

    @Column()
    order_token_name: string;

    @Column('decimal', { precision: 18, scale: 6 })
    order_qlty: number;

    @Column({ type: 'decimal', precision: 18, scale: 6 })
    order_price: number;

    @Column('decimal', { precision: 18, scale: 6, nullable: true })
    order_total_value: number;

    @Column({
        type: 'enum',
        enum: ['limit', 'market']
    })
    order_type: 'limit' | 'market';

    @Column({
        type: 'enum',
        enum: ['pending', 'executed', 'canceled', 'failed'],
        default: 'pending'
    })
    order_status: 'pending' | 'executed' | 'canceled' | 'failed';

    @Column('decimal', { precision: 18, scale: 6, nullable: true })
    order_stop_loss: number;

    @Column('decimal', { precision: 18, scale: 6, nullable: true })
    order_take_profit: number;

    @Column({ nullable: true })
    order_tx_hash: string;

    @Column({ nullable: true })
    order_error_message: string;

    @CreateDateColumn()
    order_created_at: Date;

    @UpdateDateColumn()
    order_updated_at: Date;

    @Column({ nullable: true })
    order_executed_at: Date;

    @Column({ type: 'decimal', precision: 18, scale: 6, nullable: true })
    order_price_matching: number;

    @Column('decimal', { precision: 30, scale: 15, nullable: true })
    order_balance_before: number;

    @ManyToOne(() => ListWallet)
    @JoinColumn({ name: 'order_wallet_id', referencedColumnName: 'wallet_id' })
    wallet: ListWallet;
} 