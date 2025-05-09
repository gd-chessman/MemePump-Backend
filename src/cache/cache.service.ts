import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { FileCacheService } from './file-cache.service';

@Injectable()
export class CacheService {
    private readonly logger = new Logger(CacheService.name);
    private redisErrorCount = 0;
    private lastRedisErrorTime: number;
    private fileCacheErrorCount = 0;
    private lastFileCacheErrorTime: number;
    private readonly MAX_ERRORS = 5;
    private readonly ERROR_WINDOW = 60000; // 1 minute

    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private fileCacheService: FileCacheService,
    ) {
        this.logger.log('CacheService initialized');
        // Test Redis connection
        this.testRedisConnection();
    }

    private async testRedisConnection() {
        try {
            const testKey = 'test:connection';
            await this.cacheManager.set(testKey, 'connected', 10);
            const value = await this.cacheManager.get(testKey);
            if (value === 'connected') {
                this.logger.log('✅ Redis connection successful');
            } else {
                this.logger.error('❌ Redis connection test failed - value mismatch');
            }
        } catch (error) {
            this.logger.error('❌ Redis connection test failed:', error);
        }
    }

    private isServiceHealthy(errorCount: number, lastErrorTime: number): boolean {
        if (errorCount >= this.MAX_ERRORS) {
            const timeSinceLastError = Date.now() - lastErrorTime;
            if (timeSinceLastError < this.ERROR_WINDOW) {
                return false;
            }
            // Reset error count if enough time has passed
            return true;
        }
        return true;
    }

    private isRedisHealthy(): boolean {
        return this.isServiceHealthy(this.redisErrorCount, this.lastRedisErrorTime);
    }

    private isFileCacheHealthy(): boolean {
        return this.isServiceHealthy(this.fileCacheErrorCount, this.lastFileCacheErrorTime);
    }

    async get(key: string, getOriginalData?: () => Promise<any>): Promise<any> {
        try {
            // Thử đọc từ Redis nếu healthy
            if (this.isRedisHealthy()) {
                try {
                    const redisValue = await this.cacheManager.get(key);
                    if (redisValue) {
                        this.logger.debug(`✅ Redis cache hit for key: ${key}`);
                        return redisValue;
                    }
                    this.logger.debug(`❌ Redis cache miss for key: ${key}`);
                } catch (redisError) {
                    this.logger.error('Redis error:', redisError);
                    this.redisErrorCount++;
                    this.lastRedisErrorTime = Date.now();
                }
            }

            // Thử đọc từ File Cache nếu healthy
            if (this.isFileCacheHealthy()) {
                try {
                    const fileValue = await this.fileCacheService.get(key);
                    if (fileValue) {
                        this.logger.debug(`✅ File cache hit for key: ${key}`);
                        // Nếu Redis đang healthy, cập nhật lại Redis
                        if (this.isRedisHealthy()) {
                            try {
                                await this.cacheManager.set(key, fileValue);
                                this.logger.debug(`✅ Updated Redis cache from file cache for key: ${key}`);
                            } catch (error) {
                                this.logger.error('Failed to update Redis after File Cache read:', error);
                            }
                        }
                        return fileValue;
                    }
                    this.logger.debug(`❌ File cache miss for key: ${key}`);
                } catch (fileError) {
                    this.logger.error('File Cache error:', fileError);
                    this.fileCacheErrorCount++;
                    this.lastFileCacheErrorTime = Date.now();
                }
            }

            // Nếu cả hai cache đều không có dữ liệu hoặc lỗi
            // và có hàm getOriginalData, thử lấy dữ liệu gốc
            if (getOriginalData) {
                try {
                    this.logger.warn('Both caches failed, trying to get original data');
                    const originalData = await getOriginalData();
                    
                    // Nếu lấy được dữ liệu gốc, cập nhật lại cả hai cache
                    if (originalData) {
                        // Cập nhật File Cache nếu healthy
                        if (this.isFileCacheHealthy()) {
                            try {
                                await this.fileCacheService.set(key, originalData);
                                this.logger.debug(`✅ Updated file cache with original data for key: ${key}`);
                            } catch (error) {
                                this.logger.error('Failed to update File Cache with original data:', error);
                            }
                        }

                        // Cập nhật Redis nếu healthy
                        if (this.isRedisHealthy()) {
                            try {
                                await this.cacheManager.set(key, originalData);
                                this.logger.debug(`✅ Updated Redis cache with original data for key: ${key}`);
                            } catch (error) {
                                this.logger.error('Failed to update Redis with original data:', error);
                            }
                        }
                    }
                    
                    return originalData;
                } catch (error) {
                    this.logger.error('Error getting original data:', error);
                }
            }

            return null;
        } catch (error) {
            this.logger.error(`Error getting cache for key ${key}:`, error);
            return null;
        }
    }

    async set(key: string, value: any, ttl?: number): Promise<void> {
        try {
            // Thử ghi vào File Cache nếu healthy
            if (this.isFileCacheHealthy()) {
                try {
                    await this.fileCacheService.set(key, value, ttl);
                    this.logger.debug(`✅ Set file cache for key: ${key}`);
                } catch (fileError) {
                    this.logger.error('File Cache error during set:', fileError);
                    this.fileCacheErrorCount++;
                    this.lastFileCacheErrorTime = Date.now();
                }
            }

            // Thử ghi vào Redis nếu healthy
            if (this.isRedisHealthy()) {
                try {
                    await this.cacheManager.set(key, value, ttl);
                    this.logger.debug(`✅ Set Redis cache for key: ${key}`);
                } catch (redisError) {
                    this.logger.error('Redis error during set:', redisError);
                    this.redisErrorCount++;
                    this.lastRedisErrorTime = Date.now();
                }
            }
        } catch (error) {
            this.logger.error(`Error setting cache for key ${key}:`, error);
        }
    }

    async del(key: string): Promise<void> {
        try {
            // Thử xóa từ File Cache nếu healthy
            if (this.isFileCacheHealthy()) {
                try {
                    await this.fileCacheService.del(key);
                    this.logger.debug(`✅ Deleted file cache for key: ${key}`);
                } catch (fileError) {
                    this.logger.error('File Cache error during delete:', fileError);
                    this.fileCacheErrorCount++;
                    this.lastFileCacheErrorTime = Date.now();
                }
            }

            // Thử xóa từ Redis nếu healthy
            if (this.isRedisHealthy()) {
                try {
                    await this.cacheManager.del(key);
                    this.logger.debug(`✅ Deleted Redis cache for key: ${key}`);
                } catch (redisError) {
                    this.logger.error('Redis error during delete:', redisError);
                    this.redisErrorCount++;
                    this.lastRedisErrorTime = Date.now();
                }
            }
        } catch (error) {
            this.logger.error(`Error deleting cache for key ${key}:`, error);
        }
    }

    async reset(): Promise<void> {
        try {
            // Clear File Cache
            await this.fileCacheService.clear();
            this.logger.debug('✅ Cleared file cache');
            
            // For Redis, we'll need to implement a custom solution
            // since the Cache interface doesn't provide a reset method
            // This could involve maintaining a list of keys and deleting them
            // or using Redis-specific commands if available
            console.warn('Redis cache reset is not implemented');
        } catch (error) {
            console.error('Error resetting cache:', error);
        }
    }

    async keys(): Promise<string[]> {
        try {
            // Get keys from File Cache
            const fileKeys = await this.fileCacheService.keys();
            this.logger.debug(`✅ Retrieved ${fileKeys.length} keys from file cache`);
            
            // For Redis, we'll need to implement a custom solution
            // since the Cache interface doesn't provide a keys method
            // This could involve maintaining a list of keys
            // or using Redis-specific commands if available
            console.warn('Redis keys retrieval is not implemented');
            
            return fileKeys || [];
        } catch (error) {
            console.error('Error getting cache keys:', error);
            return [];
        }
    }
} 