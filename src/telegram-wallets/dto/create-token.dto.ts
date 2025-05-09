import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsOptional, IsBoolean, Min, Max, IsArray } from 'class-validator';

export class CreateTokenDto {
    @ApiProperty({
        description: 'Tên của token',
        example: 'PPTest'
    })
    @IsString()
    @IsNotEmpty()
    name: string;

    @ApiProperty({
        description: 'Symbol của token',
        example: 'TEST'
    })
    @IsString()
    @IsNotEmpty()
    symbol: string;

    @ApiProperty({
        description: 'Mô tả về token',
        example: 'This is an example token created via PumpPortal.fun'
    })
    @IsString()
    @IsOptional()
    description?: string;

    @ApiProperty({
        description: 'URL Twitter của dự án',
        example: 'https://x.com/example'
    })
    @IsString()
    @IsOptional()
    twitter?: string;

    @ApiProperty({
        description: 'URL Telegram của dự án',
        example: 'https://t.me/example'
    })
    @IsString()
    @IsOptional()
    telegram?: string;

    @ApiProperty({
        description: 'URL Website của dự án',
        example: 'https://example.com'
    })
    @IsString()
    @IsOptional()
    website?: string;

    @ApiProperty({
        description: 'Số lượng SOL để mua token (initial liquidity). Không bắt buộc với PumpFun.',
        example: 1,
        required: false
    })
    @IsNumber()
    @Min(0.1)
    @IsOptional()
    amount?: number;

    @ApiProperty({
        description: 'Slippage cho giao dịch (phần trăm)',
        example: 10
    })
    @IsNumber()
    @Min(0)
    @Max(100)
    @IsOptional()
    slippage?: number;

    @ApiProperty({
        description: 'Priority fee cho giao dịch (SOL)',
        example: 0.0005
    })
    @IsNumber()
    @Min(0)
    @IsOptional()
    priorityFee?: number;

    @ApiProperty({
        description: 'Hiển thị tên token hay không',
        example: true
    })
    @IsBoolean()
    @IsOptional()
    showName?: boolean;

    @ApiProperty({ description: 'List of category IDs', required: false, type: [Number] })
    @IsArray()
    @IsOptional()
    category_list?: number[];
}

export class CreateTokenResponseDto {
    @ApiProperty()
    status: number;

    @ApiProperty()
    message: string;

    @ApiProperty({
        description: 'Thông tin về token đã tạo',
        required: false
    })
    data?: {
        tokenAddress: string;
        transaction: string;
        name: string;
        symbol: string;
        metadataUri: string;
    };
} 