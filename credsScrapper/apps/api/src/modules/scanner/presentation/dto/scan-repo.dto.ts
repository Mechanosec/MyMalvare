import { ESecretType } from '../../domain/constant/secret-type.constant';

export class ScanRepoDto {
  owner!: string;
  name!: string;
  secretType?: ESecretType;
}
