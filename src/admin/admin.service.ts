import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SolanaListCategoriesToken, CategoryPrioritize, CategoryStatus } from '../solana/entities/solana-list-categories-token.entity';
import { CategoryResponseDto } from './dto/category-response.dto';
import { Setting } from './entities/setting.entity';
import { DEFAULT_SETTING } from './constants';

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @InjectRepository(SolanaListCategoriesToken)
    private categoriesRepository: Repository<SolanaListCategoriesToken>,
    @InjectRepository(Setting)
    private settingRepository: Repository<Setting>,
  ) {}

  async onModuleInit() {
    await this.initializeDefaultSetting();
  }

  private async initializeDefaultSetting() {
    const count = await this.settingRepository.count();
    
    if (count === 0) {
      // Nếu chưa có dữ liệu, tạo mới với giá trị mặc định
      await this.settingRepository.save({
        appName: DEFAULT_SETTING.appName,
        logo: DEFAULT_SETTING.logo
      });
    } else if (count > 1) {
      // Nếu có nhiều hơn 1 bản ghi, xóa tất cả và tạo lại
      await this.settingRepository.clear();
      await this.settingRepository.save({
        appName: DEFAULT_SETTING.appName,
        logo: DEFAULT_SETTING.logo
      });
    }
  }

  async getSetting(): Promise<Setting> {
    const setting = await this.settingRepository.findOne({ where: {} });
    if (!setting) {
      throw new NotFoundException('Setting not found');
    }
    return setting;
  }

  async updateSetting(data: Partial<Setting>): Promise<Setting> {
    const setting = await this.settingRepository.findOne({ where: {} });
    if (!setting) {
      throw new NotFoundException('Setting not found');
    }

    Object.assign(setting, data);
    return this.settingRepository.save(setting);
  }

  async getAllCategories(): Promise<CategoryResponseDto[]> {
    const categories = await this.categoriesRepository.find({
      order: {
        slct_created_at: 'DESC'
      }
    });
    return categories;
  }

  async createCategory(data: {
    slct_name: string;
    slct_slug?: string;
    slct_prioritize?: CategoryPrioritize;
    sltc_status?: CategoryStatus;
  }): Promise<CategoryResponseDto> {
    const category = this.categoriesRepository.create({
      slct_name: data.slct_name,
      slct_slug: data.slct_slug,
      slct_prioritize: data.slct_prioritize || CategoryPrioritize.NO,
      sltc_status: data.sltc_status || CategoryStatus.ACTIVE
    });

    return this.categoriesRepository.save(category);
  }

  async updateCategory(id: number, data: {
    slct_name?: string;
    slct_slug?: string;
    slct_prioritize?: CategoryPrioritize;
    sltc_status?: CategoryStatus;
  }): Promise<CategoryResponseDto> {
    const category = await this.categoriesRepository.findOne({ where: { slct_id: id } });
    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    Object.assign(category, data);
    return this.categoriesRepository.save(category);
  }

  async deleteCategory(id: number): Promise<void> {
    const category = await this.categoriesRepository.findOne({ where: { slct_id: id } });
    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    await this.categoriesRepository.remove(category);
  }
}
