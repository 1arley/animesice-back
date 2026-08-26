import { AUDIT_KEY, Audit } from '@/auth/decorators/audit.decorator';

describe('Audit decorator', () => {
  it('registra action com resourceType padrão General', () => {
    const target = () => {};

    Audit('VIEW_USER')(target);

    expect(Reflect.getMetadata(AUDIT_KEY, target)).toEqual({
      action: 'VIEW_USER',
      resourceType: 'General',
    });
  });

  it('registra action e resourceType customizados', () => {
    const target = () => {};

    Audit('VIEW_USER', 'AdminAuditLog')(target);

    expect(Reflect.getMetadata(AUDIT_KEY, target)).toEqual({
      action: 'VIEW_USER',
      resourceType: 'AdminAuditLog',
    });
  });

  it('exporta AUDIT_KEY como string', () => {
    expect(AUDIT_KEY).toBe('audit');
  });
});
