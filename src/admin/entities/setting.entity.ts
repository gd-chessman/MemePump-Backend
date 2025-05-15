import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';
import { IsNotEmpty } from 'class-validator';
@Entity({ name: 'setting' })
@Unique(['appName']) // Tạo index duy nhất cho appName
export class Setting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false })
  @IsNotEmpty()
  appName: string;

  @Column({ nullable: false })
  @IsNotEmpty()
  logo: string;

  @Column({ nullable: true })
  @IsNotEmpty()
  telegramBot: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
