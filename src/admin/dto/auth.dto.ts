import { IsEmail, IsString, MinLength, IsEnum } from 'class-validator';
import { AdminRole } from '../entities/user-admin.entity';

export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  password: string;
}

export class RegisterDto {
  @IsString()
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsEmail()
  email: string;

  @IsEnum(AdminRole)
  role: AdminRole;
} 