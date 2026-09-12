import { Module } from '@nestjs/common';
import { ScannerModule } from './modules/scanner/scanner.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [ScannerModule, AuthModule],
})
export class AppModule {}
