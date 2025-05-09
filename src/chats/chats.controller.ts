import { Controller, Post, Get, Param, Body, UseGuards, Query, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatsService } from './chats.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiQuery } from '@nestjs/swagger';

@ApiTags('Chats')
@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
    constructor(private readonly chatsService: ChatsService) { }

    @Post('send-message/token/:token_address')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Send a message to a token chat' })
    @ApiParam({ name: 'token_address', description: 'Token address' })
    @ApiBody({ type: SendMessageDto })
    async sendMessage(
        @Param('token_address') tokenAddress: string,
        @Body() sendMessageDto: { content: string, lang?: string },
        @Request() req: any
    ) {
        try {
            const walletId = req.user.wallet_id;
            const chatHistory = await this.chatsService.sendMessage(
                tokenAddress,
                sendMessageDto.content,
                walletId,
                sendMessageDto.lang
            );
            return {
                status: 200,
                data: chatHistory
            };
        } catch (error) {
            return {
                status: 500,
                message: error.message
            };
        }
    }

    @Post('send-message/all')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Send a message to the ALL chat' })
    @ApiBody({ type: SendMessageDto })
    async sendMessageToAll(
        @Body() sendMessageDto: { content: string, lang?: string },
        @Request() req: any
    ) {
        try {
            const walletId = req.user.wallet_id;
            const chatHistory = await this.chatsService.sendMessageToAll(
                sendMessageDto.content,
                walletId,
                sendMessageDto.lang
            );
            return {
                status: 200,
                data: chatHistory
            };
        } catch (error) {
            return {
                status: 500,
                message: error.message
            };
        }
    }

    @Post('send-message/group/:group_id')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Send a message to a group chat' })
    @ApiParam({ name: 'group_id', description: 'Group ID' })
    @ApiBody({ type: SendMessageDto })
    async sendMessageToGroup(
        @Param('group_id') groupId: number,
        @Body() sendMessageDto: { content: string, lang?: string },
        @Request() req: any
    ) {
        try {
            const walletId = req.user.wallet_id;
            const chatHistory = await this.chatsService.sendMessageToGroup(
                groupId,
                sendMessageDto.content,
                walletId,
                sendMessageDto.lang
            );
            return {
                status: 200,
                data: chatHistory
            };
        } catch (error) {
            return {
                status: 500,
                message: error.message
            };
        }
    }

    @Get('all-histories')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get chat history for ALL chat' })
    @ApiQuery({ name: 'lang', required: false, type: String })
    async getAllChatHistories(
        @Query('lang') lang: string = 'kr',
        @Request() req: any
    ) {
        try {
            const walletId = req.user.wallet_id;
            const { histories, last_read } = await this.chatsService.getAllChatHistories(50, 0, walletId, lang);
            return {
                status: 200,
                last_read,
                data: histories
            };
        } catch (error) {
            return {
                status: 500,
                message: error.message
            };
        }
    }

    @Get('token-histories/:token_address')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get chat history for a specific token' })
    @ApiParam({ name: 'token_address', description: 'Token address' })
    @ApiQuery({ name: 'lang', required: false, type: String })
    async getTokenChatHistories(
        @Param('token_address') tokenAddress: string,
        @Query('lang') lang: string = 'kr',
        @Request() req: any
    ) {
        try {
            const walletId = req.user.wallet_id;
            const { histories, last_read } = await this.chatsService.getTokenChatHistories(tokenAddress, 50, 0, walletId, lang);
            return {
                status: 200,
                last_read,
                data: histories
            };
        } catch (error) {
            return {
                status: 500,
                message: error.message
            };
        }
    }

    @Get('group-histories/:group_id')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get chat history for a specific group' })
    @ApiParam({ name: 'group_id', description: 'Group ID' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiQuery({ name: 'skip', required: false, type: Number })
    @ApiQuery({ name: 'lang', required: false, type: String })
    async getGroupChatHistories(
        @Param('group_id') groupId: number,
        @Query('limit') limit: number = 50,
        @Query('skip') skip: number = 0,
        @Query('lang') lang: string = 'kr',
        @Request() req: any
    ) {
        try {
            const walletId = req.user.wallet_id;
            const { histories, last_read } = await this.chatsService.getGroupChatHistories(
                groupId,
                walletId,
                limit,
                skip,
                lang
            );
            return {
                status: 200,
                last_read,
                data: histories
            };
        } catch (error) {
            return {
                status: 500,
                message: error.message
            };
        }
    }

    @Post('read-all')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Mark all messages in ALL chat as read' })
    async markAllAsRead(@Request() req: any) {
        try {
            const walletId = req.user.wallet_id;
            const result = await this.chatsService.markAllAsRead(walletId);
            return {
                status: 200,
                data: result
            };
        } catch (error) {
            return {
                status: 500,
                message: error.message
            };
        }
    }

    @Post('read-token/:token_address')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Mark all messages in a token chat as read' })
    @ApiParam({ name: 'token_address', description: 'Token address' })
    async markTokenAsRead(
        @Param('token_address') tokenAddress: string,
        @Request() req: any
    ) {
        try {
            const walletId = req.user.wallet_id;
            const result = await this.chatsService.markTokenAsRead(walletId, tokenAddress);
            return {
                status: 200,
                data: result
            };
        } catch (error) {
            return {
                status: 500,
                message: error.message
            };
        }
    }

    @Post('read-group/:group_id')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Mark all messages in a group chat as read' })
    @ApiParam({ name: 'group_id', description: 'Group ID' })
    async markGroupAsRead(
        @Param('group_id') groupId: number,
        @Request() req: any
    ) {
        try {
            const walletId = req.user.wallet_id;
            const result = await this.chatsService.markGroupAsRead(walletId, groupId);
            return {
                status: 200,
                data: result
            };
        } catch (error) {
            return {
                status: 500,
                message: error.message
            };
        }
    }
} 