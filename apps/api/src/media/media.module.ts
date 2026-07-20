import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module";
import { JobsModule } from "../jobs/jobs.module";
import { MEDIA_STORAGE, createMediaStorage } from "./media-storage";
import { ImageProcessorService } from "./image-processor.service";
import { MediaController } from "./media.controller";
import { MediaProcessingService } from "./media-processing.service";
import { MediaService } from "./media.service";

@Module({
  imports: [AuthModule, JobsModule],
  controllers: [MediaController],
  providers: [
    MediaService,
    ImageProcessorService,
    MediaProcessingService,
    {
      provide: MEDIA_STORAGE,
      inject: [ConfigService],
      useFactory: createMediaStorage
    }
  ],
  exports: [MediaService, MediaProcessingService, ImageProcessorService, MEDIA_STORAGE]
})
export class MediaModule {}
