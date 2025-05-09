import { Module, Global } from '@nestjs/common';
import { CacheService } from './cache.service';
import { FileCacheService } from './file-cache.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import * as redisStore from 'cache-manager-redis-store';

@Global()
@Module({
    imports: [
        NestCacheModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: async (configService: ConfigService) => ({
                store: redisStore,
                host: configService.get('REDIS_HOST'),
                port: configService.get('REDIS_PORT'),
                password: configService.get('REDIS_PASSWORD'),
                ttl: 86400, // 24 hours
                isGlobal: true,
                retry_strategy: function(options) {
                    if (options.error && options.error.code === 'ECONNREFUSED') {
                        // End reconnecting on a specific error and flush all commands with a individual error
                        return new Error('The server refused the connection');
                    }
                    if (options.total_retry_time > 1000 * 60 * 60) {
                        // End reconnecting after a specific timeout and flush all commands with a individual error
                        return new Error('Retry time exhausted');
                    }
                    if (options.attempt > 10) {
                        // End reconnecting with built in error
                        return undefined;
                    }
                    // reconnect after
                    return Math.min(options.attempt * 100, 3000);
                },
                enable_offline_queue: true,
                connect_timeout: 10000,
                max_retries_per_request: 3,
                db: 0,
                keyPrefix: 'cache:',
                socket: {
                    keepAlive: 5000,
                    reconnectStrategy: function(times) {
                        return Math.min(times * 50, 2000);
                    }
                }
            }),
        }),
    ],
    providers: [CacheService, FileCacheService],
    exports: [CacheService, FileCacheService, NestCacheModule],
})
export class CacheModule { } 