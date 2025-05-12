import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe, Query, UseGuards, Request, Res, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminService } from './admin.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CategoryPrioritize, CategoryStatus } from '../solana/entities/solana-list-categories-token.entity';
import { Setting } from './entities/setting.entity';
import { AdminGateway } from './admin.gateway';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { Response } from 'express';
import { JwtAuthAdminGuard } from './guards/jwt-auth.guard';

@ApiTags('admin')
@Controller('admin')
// @UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminGateway: AdminGateway
  ) {}

  // Setting endpoints
  @Get('setting')
  // @UseGuards(JwtAuthAdminGuard)
  async getSetting(): Promise<Setting> {
    return this.adminService.getSetting();
  }

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
  @Get('categories-token')
  async getAllCategories(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 100
  ): Promise<{ data: CategoryResponseDto[]; total: number; page: number; limit: number }> {
    return this.adminService.getAllCategories(page, limit);
  }

  @Post('categories-token')
  async createCategory(
    @Body() data: {
      slct_name: string;
      slct_slug: string;
    }
  ): Promise<CategoryResponseDto> {
    return this.adminService.createCategory(data);
  }

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

  @Delete('categories-token/:id')
  async deleteCategory(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.adminService.deleteCategory(id);
  }

  @Get('online-stats')
  @ApiOperation({ summary: 'Get online users statistics' })
  @ApiResponse({ status: 200, description: 'Returns online users statistics' })
  async getOnlineStats() {
    return this.adminGateway.handleGetOnlineStats();
  }

  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.adminService.register(registerDto);
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.adminService.login(loginDto, response);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Res({ passthrough: true }) response: Response) {
    return this.adminService.logout(response);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }
}
