import { Entity, Column, OneToMany, BeforeInsert } from 'typeorm';
import { WalletAuth } from './wallet-auth.entity';

@Entity('user_wallets')
export class UserWallet {
    @Column({ primary: true })
    uw_id: number;

    @Column()
    uw_telegram_id: string;

    @Column({ nullable: true })
    uw_phone: string;

    @Column({ nullable: true })
    uw_email: string;

    @Column({ nullable: true })
    uw_password: string;

    @OneToMany(() => WalletAuth, walletAuth => walletAuth.wa_user)
    wallet_auths: WalletAuth[];

    @BeforeInsert()
    async setInitialId() {
        if (!this.uw_id) {
            // Sử dụng một giá trị dựa trên timestamp + random để giảm khả năng trùng lặp
            const timestamp = new Date().getTime();
            const random = Math.floor(Math.random() * 1000);
            this.uw_id = 7251125 + timestamp % 10000 + random;
        }
    }
}