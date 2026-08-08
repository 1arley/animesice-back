import { SetMetadata } from '@nestjs/common';

export const VERIFIED_KEY = 'verified';
export const Verified = () => SetMetadata(VERIFIED_KEY, true);
