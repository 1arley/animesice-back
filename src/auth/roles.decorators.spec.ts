import { ROLES_KEY, Roles } from '@/auth/roles.decorators';

describe('Roles decorator', () => {
  it('registra as roles como metadata na chave correta', () => {
    const target = () => {};

    Roles('ADMIN', 'SUPERADMIN')(target);

    expect(Reflect.getMetadata(ROLES_KEY, target)).toEqual([
      'ADMIN',
      'SUPERADMIN',
    ]);
  });

  it('registra uma única role', () => {
    const target = () => {};

    Roles('ADMIN')(target);

    expect(Reflect.getMetadata(ROLES_KEY, target)).toEqual(['ADMIN']);
  });

  it('registra array vazio quando não há roles', () => {
    const target = () => {};

    Roles()(target);

    expect(Reflect.getMetadata(ROLES_KEY, target)).toEqual([]);
  });

  it('exporta ROLES_KEY como string', () => {
    expect(ROLES_KEY).toBe('roles');
  });
});
