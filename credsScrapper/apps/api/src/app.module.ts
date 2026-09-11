import { Module } from '@nestjs/common';
import { ScannerModule } from './modules/scanner/scanner.module';

@Module({
  imports: [ScannerModule],
})
export class AppModule {}
