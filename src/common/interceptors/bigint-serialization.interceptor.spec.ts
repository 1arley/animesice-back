import { of } from 'rxjs';
import { BigIntSerializationInterceptor } from '@/common/interceptors/bigint-serialization.interceptor';

describe('BigIntSerializationInterceptor', () => {
  it('serializes nested bigint values as strings', (done) => {
    const interceptor = new BigIntSerializationInterceptor();
    const next = { handle: () => of({ balance: 12n, nested: { total: 4n } }) };

    interceptor.intercept({} as never, next).subscribe((value) => {
      expect(value).toEqual({ balance: '12', nested: { total: '4' } });
      done();
    });
  });
});
