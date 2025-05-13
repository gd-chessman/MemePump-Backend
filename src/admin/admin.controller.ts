import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe, Query, UseGuards, Request, Res, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CategoryPrioritize, CategoryStatus } from '../solana/entities/solana-list-categories-token.entity';
import { Setting } from './entities/setting.entity';
import { AdminGateway } from './admin.gateway';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Response } from 'express';
import { JwtAuthAdminGuard } from './guards/jwt-auth.guard';
import { UserWallet } from '../telegram-wallets/entities/user-wallet.entity';
import { ProfileResponseDto } from './dto/profile-response.dto';

@ApiTags('admin')
@Controller('admin')
// @UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminGateway: AdminGateway
  ) {}

  // @Post('register')
  // register(@Body() registerDto: RegisterDto) {
  //   return this.adminService.register(registerDto);
  // }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.adminService.login(loginDto, response);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) response: Response) {
    return this.adminService.logout(response);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('me')
  @ApiOperation({ summary: 'Get admin profile' })
  @ApiResponse({ status: 200, type: ProfileResponseDto })
  getProfile(@Request() req): ProfileResponseDto {
    const { password, ...profile } = req.user;
    return profile;
  }

  @UseGuards(JwtAuthAdminGuard)
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @Request() req,
    @Body() changePasswordDto: ChangePasswordDto
  ) {
    return this.adminService.changePassword(
      req.user.username,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword
    );
  }

  // Setting endpoints
  @UseGuards(JwtAuthAdminGuard)
  @Get('setting')
  async getSetting(): Promise<Setting> {
    return this.adminService.getSetting();
  }

  @UseGuards(JwtAuthAdminGuard)
  @Put('setting')
  async updateSetting(
    @Body() data: {
      appName?: string;
      logo?: string;
    }
  ): Promise<Setting> {
    return this.adminService.updateSetting(data);
  }

  // Category endpoints
  @UseGuards(JwtAuthAdminGuard)
  @Get('categories-token')
  async getAllCategories(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 100
  ): Promise<{ data: CategoryResponseDto[]; total: number; page: number; limit: number }> {
    return this.adminService.getAllCategories(page, limit);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Post('categories-token')
  async createCategory(
    @Body() data: {
      slct_name: string;
      slct_slug: string;
    }
  ): Promise<CategoryResponseDto> {
    return this.adminService.createCategory(data);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Put('categories-token/:id')
  async updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: {
      slct_name?: string;
      slct_slug?: string;
      slct_prioritize?: CategoryPrioritize;
      sltc_status?: CategoryStatus;
    }
  ): Promise<CategoryResponseDto> {
    return this.adminService.updateCategory(id, data);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Delete('categories-token/:id')
  async deleteCategory(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.adminService.deleteCategory(id);
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('online-stats')
  @ApiOperation({ summary: 'Get online users statistics' })
  @ApiResponse({ status: 200, description: 'Returns online users statistics' })
  async getOnlineStats() {
    return this.adminGateway.handleGetOnlineStats();
  }

  @UseGuards(JwtAuthAdminGuard)
  @Get('user-wallets')
  @ApiOperation({ summary: 'Get list of user wallets' })
  @ApiResponse({ status: 200, description: 'Returns list of user wallets with pagination' })
  async getUserWallets(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10
  ): Promise<{ data: UserWallet[]; total: number; page: number; limit: number }> {
    return this.adminService.getUserWallets(page, limit);
  }
}
