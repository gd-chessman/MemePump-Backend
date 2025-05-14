import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

@Entity({ name: 'setting' })
@Unique(['appName']) // Tạo index duy nhất cho appName
export class Setting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: false })
  appName: string;

  @Column({ nullable: false })
  logo: string;

  @Column({ nullable: true })
  favicon: string;

  @Column({ nullable: true })
  telegramBot: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
