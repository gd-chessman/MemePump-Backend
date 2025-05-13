import { Injectable, NotFoundException, OnModuleInit, UnauthorizedException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SolanaListCategoriesToken, CategoryPrioritize, CategoryStatus } from '../solana/entities/solana-list-categories-token.entity';
import { CategoryResponseDto } from './dto/category-response.dto';
import { Setting } from './entities/setting.entity';
import { DEFAULT_SETTING, DEFAULT_USER_ADMIN } from './constants';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserAdmin } from './entities/user-admin.entity';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { AdminRole } from './entities/user-admin.entity';
import { Response } from 'express';
import { UserWallet } from '../telegram-wallets/entities/user-wallet.entity';

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    @InjectRepository(SolanaListCategoriesToken)
    private categoriesRepository: Repository<SolanaListCategoriesToken>,
    @InjectRepository(Setting)
    private settingRepository: Repository<Setting>,
    @InjectRepository(UserAdmin)
    private userAdminRepository: Repository<UserAdmin>,
    @InjectRepository(UserWallet)
    private userWalletRepository: Repository<UserWallet>,
    private jwtService: JwtService,
  ) {}

  async onModuleInit() {
    await this.initializeDefaultSetting();
    await this.initializeDefaultAdmin();
  }

  private async initializeDefaultSetting() {
    const count = await this.settingRepository.count();
    
    if (count === 0) {
      // Nếu chưa có dữ liệu, tạo mới với giá trị mặc định
      await this.settingRepository.save({
        appName: DEFAULT_SETTING.appName,
        logo: DEFAULT_SETTING.logo,
        telegramBot: DEFAULT_SETTING.telegramBot
      });
    } else if (count > 1) {
      // Nếu có nhiều hơn 1 bản ghi, xóa tất cả và tạo lại
      await this.settingRepository.clear();
      await this.settingRepository.save({
        appName: DEFAULT_SETTING.appName,
        logo: DEFAULT_SETTING.logo,
        telegramBot: DEFAULT_SETTING.telegramBot
      });
    }
  }

  private async initializeDefaultAdmin() {
    const adminCount = await this.userAdminRepository.count();
    
    if (adminCount === 0) {
      const hashedPassword = await bcrypt.hash(DEFAULT_USER_ADMIN.password, 10);
      
      await this.userAdminRepository.save({
        username: DEFAULT_USER_ADMIN.username,
        email: DEFAULT_USER_ADMIN.email,
        password: hashedPassword,
        role: AdminRole.ADMIN
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

  async updateSetting(data: {
    appName?: string;
    logo?: string;
    telegramBot?: string;
  }): Promise<Setting> {
    const setting = await this.settingRepository.findOne({ where: {} });
    if (!setting) {
      throw new NotFoundException('Setting not found');
    }

    if (data.appName !== undefined) {
      setting.appName = data.appName;
    }
    if (data.logo !== undefined) {
      setting.logo = data.logo;
    }
    if (data.telegramBot !== undefined) {
      setting.telegramBot = data.telegramBot;
    }

    return this.settingRepository.save(setting);
  }

  async getAllCategories(
    page: number = 1,
    limit: number = 100,
    search?: string
  ): Promise<{ data: CategoryResponseDto[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    
    const queryBuilder = this.categoriesRepository.createQueryBuilder('category');

    if (search) {
      queryBuilder.where(
        '(category.slct_name ILIKE :search OR category.slct_slug ILIKE :search)',
        { search: `%${search}%` }
      );
    }

    const [categories, total] = await queryBuilder
      .orderBy('category.slct_created_at', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data: categories,
      total,
      page,
      limit
    };
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

    if (data.slct_name !== undefined) {
      category.slct_name = data.slct_name;
    }
    if (data.slct_slug !== undefined) {
      category.slct_slug = data.slct_slug;
    }
    if (data.slct_prioritize !== undefined) {
      category.slct_prioritize = data.slct_prioritize;
    }
    if (data.sltc_status !== undefined) {
      category.sltc_status = data.sltc_status;
    }

    return this.categoriesRepository.save(category);
  }

  async deleteCategory(id: number): Promise<{ message: string }> {
    const category = await this.categoriesRepository.findOne({ where: { slct_id: id } });
    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    await this.categoriesRepository.remove(category);
    return { message: 'Category deleted successfully' };
  }

  async register(registerDto: RegisterDto): Promise<UserAdmin> {
    const { username, email, password, role } = registerDto;

    // Check if username or email already exists
    const existingUser = await this.userAdminRepository.findOne({
      where: [{ username }, { email }],
    });

    if (existingUser) {
      throw new ConflictException('Username or email already exists');
    }

    // If trying to register as ADMIN, check if admin already exists
    if (role === AdminRole.ADMIN) {
      const adminExists = await this.userAdminRepository.findOne({
        where: { role: AdminRole.ADMIN }
      });

      if (adminExists) {
        throw new ConflictException('Admin account already exists');
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user
    const user = this.userAdminRepository.create({
      username,
      email,
      password: hashedPassword,
      role,
    });

    return this.userAdminRepository.save(user);
  }

  async login(loginDto: LoginDto, response: Response): Promise<{ message: string }> {
    const { username, password } = loginDto;

    // Find user
    const user = await this.userAdminRepository.findOne({
      where: { username },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate JWT token
    const payload = { 
      sub: user.id, 
      username: user.username,
      role: user.role 
    };
    const token = this.jwtService.sign(payload);

    // Set HTTP-only cookie
    response.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    });

    return { message: 'Login successfully' };
  }

  async logout(response: Response): Promise<{ message: string }> {
    response.clearCookie('access_token');
    return { message: 'Logged out successfully' };
  }

  async validateUser(username: string): Promise<UserAdmin> {
    const user = await this.userAdminRepository.findOne({ where: { username } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }

  async changePassword(username: string, currentPassword: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.userAdminRepository.findOne({ where: { username } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedNewPassword;
    await this.userAdminRepository.save(user);

    return { message: 'Password changed successfully' };
  }

  async getUserWallets(
    page: number = 1,
    limit: number = 100,
    search?: string
  ): Promise<{ data: UserWallet[]; total: number; page: number; limit: number }> {
    const skip = (page - 1) * limit;
    
    const queryBuilder = this.userWalletRepository.createQueryBuilder('wallet')
      .leftJoinAndSelect('wallet.wallet_auths', 'wallet_auths');

    if (search) {
      queryBuilder.where('wallet.uw_telegram_id ILIKE :search', { search: `%${search}%` });
    }

    const [wallets, total] = await queryBuilder
      .orderBy('wallet.uw_id', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data: wallets,
      total,
      page,
      limit
    };
  }
}
