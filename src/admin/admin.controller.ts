import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe, Query } from '@nestjs/common';
import { AdminService } from './admin.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CategoryPrioritize, CategoryStatus } from '../solana/entities/solana-list-categories-token.entity';
import { Setting } from './entities/setting.entity';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // Setting endpoints
  @Get('setting')
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
}
