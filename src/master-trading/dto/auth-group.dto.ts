import { IsNotEmpty, IsNumber, IsEnum } from 'class-validator';

export class AuthGroupDto {
    @IsNotEmpty()
    @IsNumber()
    mga_group_id: number;
}

export class ChangeAuthStatusDto {
    @IsNotEmpty()
    @IsNumber()
    mga_group_id: number;

    @IsNotEmpty()
    @IsEnum(['running', 'pause'])
    mga_status: 'running' | 'pause';
} 