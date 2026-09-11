import { IJobProgressEvent } from '../../domain/types/job-progress-event.type';

export abstract class ProgressPort {
  abstract emit(event: IJobProgressEvent): void;
}
