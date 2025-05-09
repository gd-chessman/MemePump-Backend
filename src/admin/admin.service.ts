import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SolanaListCategoriesToken, CategoryPrioritize, CategoryStatus } from '../solana/entities/solana-list-categories-token.entity';
import { CategoryResponseDto } from './dto/category-response.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(SolanaListCategoriesToken)
    private categoriesRepository: Repository<SolanaListCategoriesToken>,
  ) {}

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
