import { Entity, Column, OneToMany, BeforeInsert, getConnection, DataSource } from 'typeorm';
import { WalletAuth } from './wallet-auth.entity';
import { BlockChat } from '../../chats/entities/block-chat.entity';
import { Chat } from '../../chats/entities/chat.entity';

@Entity('list_wallets')
export class ListWallet {
    @Column({ primary: true })
    wallet_id: number;

    @Column({ type: 'text' })
    wallet_private_key: string;

    @Column()
    wallet_solana_address: string;

    @Column()
    wallet_eth_address: string;

    @Column({
        type: 'enum',
        enum: ['member', 'master']
    })
    wallet_auth: string;

    @Column({
        type: 'enum',
        enum: ['normal', 'vip'],
        nullable: true
    })
    wallet_stream: string;

    @Column()
    wallet_status: boolean;

    @Column({
        type: 'varchar',
        length: 150,
        unique: true,
        nullable: true
    })
    wallet_nick_name: string;

    @Column({
        type: 'varchar',
        length: 50,
        nullable: true
    })
    wallet_country: string;

    @OneToMany(() => WalletAuth, walletAuth => walletAuth.wa_wallet)
    wallet_auths: WalletAuth[];

    @OneToMany(() => BlockChat, blockChat => blockChat.wallet)
    blockChats: BlockChat[];

    @OneToMany(() => Chat, chat => chat.wallet)
    chats: Chat[];

    @BeforeInsert()
    async setInitialId() {
        if (!this.wallet_id) {
            // Sử dụng một giá trị dựa trên timestamp + random để giảm khả năng trùng lặp
            const timestamp = new Date().getTime();
            const random = Math.floor(Math.random() * 1000);
            this.wallet_id = 3251125 + timestamp % 10000 + random;
        }
    }
}