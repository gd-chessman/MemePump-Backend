import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIndexes1713441600001 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add indexes for solana_list_token
        await queryRunner.query(`
            CREATE INDEX "IDX_solana_list_token_address" ON "solana_list_token" ("slt_address");
            CREATE INDEX "IDX_solana_list_token_symbol" ON "solana_list_token" ("slt_symbol");
            CREATE INDEX "IDX_solana_list_token_is_verified" ON "solana_list_token" ("slt_is_verified");
        `);

        // Add indexes for solana_list_categories_token
        await queryRunner.query(`
            CREATE INDEX "IDX_solana_list_categories_token_slug" ON "solana_list_categories_token" ("slct_slug");
            CREATE INDEX "IDX_solana_list_categories_token_status" ON "solana_list_categories_token" ("sltc_status");
        `);

        // Add indexes for solana_token_join_category
        await queryRunner.query(`
            CREATE INDEX "IDX_solana_token_join_category_token_id" ON "solana_token_join_category" ("stjc_token_id");
            CREATE INDEX "IDX_solana_token_join_category_category_id" ON "solana_token_join_category" ("stjc_category_id");
            CREATE INDEX "IDX_solana_token_join_category_status" ON "solana_token_join_category" ("stjc_status");
        `);

        // Add indexes for solana_wishlist_token
        await queryRunner.query(`
            CREATE INDEX "IDX_solana_wishlist_token_token_id" ON "solana_wishlist_token" ("swt_token_id");
            CREATE INDEX "IDX_solana_wishlist_token_wallet_id" ON "solana_wishlist_token" ("swt_wallet_id");
            CREATE INDEX "IDX_solana_wishlist_token_status" ON "solana_wishlist_token" ("swt_status");
        `);

        // Add indexes for trading_orders
        await queryRunner.query(`
            CREATE INDEX "IDX_trading_orders_wallet_id" ON "trading_orders" ("order_wallet_id");
            CREATE INDEX "IDX_trading_orders_token_address" ON "trading_orders" ("order_token_address");
            CREATE INDEX "IDX_trading_orders_status" ON "trading_orders" ("order_status");
            CREATE INDEX "IDX_trading_orders_created_at" ON "trading_orders" ("order_created_at");
        `);

        // Add indexes for order_books
        await queryRunner.query(`
            CREATE INDEX "IDX_order_books_token_address" ON "order_books" ("token_address");
            CREATE INDEX "IDX_order_books_price" ON "order_books" ("price");
            CREATE INDEX "IDX_order_books_quantity" ON "order_books" ("quantity");
            CREATE INDEX "IDX_order_books_side" ON "order_books" ("side");
        `);

        // Add indexes for master_transaction
        await queryRunner.query(`
            CREATE INDEX "IDX_master_transaction_master_wallet" ON "master_transaction" ("mt_master_wallet");
            CREATE INDEX "IDX_master_transaction_token_address" ON "master_transaction" ("mt_token_address");
            CREATE INDEX "IDX_master_transaction_status" ON "master_transaction" ("mt_status");
        `);

        // Add indexes for master_transaction_detail
        await queryRunner.query(`
            CREATE INDEX "IDX_master_transaction_detail_transaction_id" ON "master_transaction_detail" ("mt_transaction_id");
            CREATE INDEX "IDX_master_transaction_detail_wallet_master" ON "master_transaction_detail" ("mt_wallet_master");
            CREATE INDEX "IDX_master_transaction_detail_token_address" ON "master_transaction_detail" ("mt_detail_token_address");
            CREATE INDEX "IDX_master_transaction_detail_status" ON "master_transaction_detail" ("mt_detail_status");
        `);

        // Add indexes for position_tracking
        await queryRunner.query(`
            CREATE INDEX "IDX_position_tracking_token_address" ON "position_tracking" ("pt_token_address");
            CREATE INDEX "IDX_position_tracking_status" ON "position_tracking" ("pt_status");
            CREATE INDEX "IDX_position_tracking_entry_time" ON "position_tracking" ("pt_entry_time");
            CREATE INDEX "IDX_position_tracking_exit_time" ON "position_tracking" ("pt_exit_time");
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop indexes for solana_list_token
        await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_solana_list_token_address";
            DROP INDEX IF EXISTS "IDX_solana_list_token_symbol";
            DROP INDEX IF EXISTS "IDX_solana_list_token_is_verified";
        `);

        // Drop indexes for solana_list_categories_token
        await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_solana_list_categories_token_slug";
            DROP INDEX IF EXISTS "IDX_solana_list_categories_token_status";
        `);

        // Drop indexes for solana_token_join_category
        await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_solana_token_join_category_token_id";
            DROP INDEX IF EXISTS "IDX_solana_token_join_category_category_id";
            DROP INDEX IF EXISTS "IDX_solana_token_join_category_status";
        `);

        // Drop indexes for solana_wishlist_token
        await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_solana_wishlist_token_token_id";
            DROP INDEX IF EXISTS "IDX_solana_wishlist_token_wallet_id";
            DROP INDEX IF EXISTS "IDX_solana_wishlist_token_status";
        `);

        // Drop indexes for trading_orders
        await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_trading_orders_wallet_id";
            DROP INDEX IF EXISTS "IDX_trading_orders_token_address";
            DROP INDEX IF EXISTS "IDX_trading_orders_status";
            DROP INDEX IF EXISTS "IDX_trading_orders_created_at";
        `);

        // Drop indexes for order_books
        await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_order_books_token_address";
            DROP INDEX IF EXISTS "IDX_order_books_price";
            DROP INDEX IF EXISTS "IDX_order_books_quantity";
            DROP INDEX IF EXISTS "IDX_order_books_side";
        `);

        // Drop indexes for master_transaction
        await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_master_transaction_master_wallet";
            DROP INDEX IF EXISTS "IDX_master_transaction_token_address";
            DROP INDEX IF EXISTS "IDX_master_transaction_status";
        `);

        // Drop indexes for master_transaction_detail
        await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_master_transaction_detail_transaction_id";
            DROP INDEX IF EXISTS "IDX_master_transaction_detail_wallet_master";
            DROP INDEX IF EXISTS "IDX_master_transaction_detail_token_address";
            DROP INDEX IF EXISTS "IDX_master_transaction_detail_status";
        `);

        // Drop indexes for position_tracking
        await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_position_tracking_token_address";
            DROP INDEX IF EXISTS "IDX_position_tracking_status";
            DROP INDEX IF EXISTS "IDX_position_tracking_entry_time";
            DROP INDEX IF EXISTS "IDX_position_tracking_exit_time";
        `);
    }
} 