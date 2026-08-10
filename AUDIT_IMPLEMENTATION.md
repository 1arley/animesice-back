# 🔒 Implementação de Auditoria - Relatório Completo

## ✅ O que foi implementado

### 1. **Tabela de Auditoria (AdminAuditLog)**

```sql
CREATE TABLE "AdminAuditLog" (
    id             TEXT PRIMARY KEY (UUID)
    adminId        TEXT FOREIGN KEY → User
    action         TEXT              -- "LIST_USERS", "VIEW_USER", etc
    resourceType   TEXT              -- "User", "Comment", "Report"
    resourceId     TEXT              -- ID do recurso acessado (opcional)
    ipAddress      TEXT              -- IP do admin
    userAgent      TEXT              -- Browser/cliente do admin
    status         TEXT              -- "SUCCESS" ou "FAILED"
    errorMessage   TEXT              -- Mensagem de erro se falhar
    dataAccessed   INT               -- Quantos registros foram acessados
    createdAt      TIMESTAMP         -- Data/hora do acesso
)

Índices:
  - [adminId, createdAt]  → Rápido achar histórico de um admin
  - [action, createdAt]   → Rápido filtrar por tipo de ação
  - [resourceType]        → Rápido encontrar acessos a User, Comment, etc
```

### 2. **AuditService** (`src/common/services/audit.service.ts`)

Funcionalidades:
- `log()` - Registra um acesso na auditoria
- `logRequest()` - Log com dados de request (IP, user-agent)
- `logError()` - Log de erros com mensagem de erro
- `getAdminActivity()` - Ver histórico de um admin
- `getSensitiveDataAccess()` - Ver acessos sensíveis (últimos 7 dias)

**Uso:**
```typescript
// Em um serviço
await this.auditService.logRequest(
  adminId: "user-123",
  action: "LIST_USERS",
  resourceType: "User",
  req,          // Express Request
  undefined,    // resourceId (opcional)
  5             // dataAccessed (quantos registros)
);
```

### 3. **Audit Decorator** (`src/auth/decorators/audit.decorator.ts`)

Marca um endpoint para ser auditado:
```typescript
@Get()
@Roles('ADMIN', 'SUPERADMIN')
@Audit('LIST_USERS', 'User')  // ← Ativa auditoria
findAll(...) { ... }
```

Ações registradas:
- `LIST_USERS` - Listou usuários (quantos)
- `VIEW_USER` - Visualizou um usuário específico
- `DELETE_USER` - Deletou um usuário
- etc...

### 4. **Audit Interceptor** (`src/common/interceptors/audit.interceptor.ts`)

- Intercepta requisições com `@Audit()`
- Registra IP, User-Agent, hora
- Detecta quantos dados foram retornados
- Registra erros automaticamente
- **Não bloqueia a requisição** - se auditoria falhar, requisição continua

### 5. **Audit Controller** (`src/admin/audit.controller.ts`)

Novo endpoint: `GET /api/admin/audit/sensitive-access`

**Acesso**: Apenas SUPERADMIN
**Auditado**: Sim (VIEW_AUDIT_LOGS)

Retorna logs dos últimos 7 dias de:
- Listagem de usuários
- Visualização de usuários
- Listagem de emails

Exemplo resposta:
```json
[
  {
    "id": "audit-123",
    "action": "LIST_USERS",
    "resourceType": "User",
    "admin": {
      "email": "arthuriarley323@gmail.com",
      "role": "SUPERADMIN"
    },
    "ipAddress": "192.168.1.100",
    "userAgent": "Mozilla/5.0...",
    "dataAccessed": 5,
    "status": "SUCCESS",
    "createdAt": "2026-08-10T17:50:00Z"
  },
  ...
]
```

### 6. **SELECT() Explícito no Prisma**

**ANTES (INSEGURO)**:
```typescript
const users = await this.prisma.user.findMany({ ... });
const safeUsers = users.map(u => {
  const { password, ...safe } = u;
  return safe;
});
// ❌ Se houver erro aqui, password pode ser logada!
```

**DEPOIS (SEGURO)**:
```typescript
const users = await this.prisma.user.findMany({
  select: {
    id: true,
    email: true,
    name: true,
    userName: true,
    role: true,
    isVerified: true,
    avatar: true,
    bio: true,
    createdAt: true,
    updatedAt: true,
    // ✅ password NUNCA é recuperado do banco!
  },
});
```

---

## 📊 Como a Auditoria Funciona

### Fluxo de uma requisição:

```
1. Admin acessa: GET /api/user?page=1
   ↓
2. JwtAuthGuard valida token
   ↓
3. RolesGuard valida que é ADMIN/SUPERADMIN
   ↓
4. AuditInterceptor intercepta (@Audit decorator)
   ↓
5. Controller executa: userService.findAll()
   ↓
6. Prisma retorna usuários (com SELECT explícito)
   ↓
7. AuditInterceptor registra na DB:
   - adminId: "user-123"
   - action: "LIST_USERS"
   - ipAddress: "192.168.1.100"
   - dataAccessed: 5
   - status: "SUCCESS"
   ↓
8. Resposta é enviada para o admin
```

### O que É Registrado?

| Campo | O Quê | Quando |
|-------|-------|--------|
| adminId | ID do admin que fez a ação | Sempre |
| action | O que foi feito (LIST_USERS, etc) | Sempre |
| resourceType | Tipo de recurso (User, Comment, etc) | Sempre |
| ipAddress | IP de onde veio a requisição | Sempre |
| userAgent | Browser/cliente do admin | Sempre |
| dataAccessed | Quantos registros foram acessados | Sempre |
| status | SUCCESS ou FAILED | Sempre |
| errorMessage | Mensagem se falhou | Se houver erro |
| createdAt | Data/hora do acesso | Sempre |

---

## 🚀 Como Usar

### 1. Preparar o banco de dados

```bash
# Aplicar a migration
npm run prisma:migrate
```

### 2. Adicionar auditoria a novos endpoints

```typescript
@Get(':id')
@Roles('ADMIN', 'SUPERADMIN')
@Audit('VIEW_USER', 'User')  // ← Adicione isto
async findOne(@Param('id') id: string) {
  return this.userService.findOne(id);
}
```

### 3. Ver logs de auditoria

```bash
# Como SUPERADMIN
GET /api/admin/audit/sensitive-access
Authorization: Bearer <token>
```

### 4. Consultar via código (em um serviço)

```typescript
// Ver o que um admin fez
const adminActivity = await this.auditService.getAdminActivity(adminId);

// Ver quem acessou dados sensíveis
const sensitiveAccess = await this.auditService.getSensitiveDataAccess('User', 7);
```

---

## 🔐 Benefícios de Segurança

| Benefício | Impacto |
|-----------|--------|
| **Rastreabilidade** | Saber EXATAMENTE quem acessou dados, quando e de onde |
| **Detecção de anomalias** | Admin acessando 1000 usuários em 1min = suspeito! |
| **Conformidade** | LGPD/GDPR exigem logs de acesso a PII |
| **Investigação** | Se dados vazarem, você sabe quem teve acesso |
| **Prevenção** | Admin sabe que está sendo monitorado |

---

## ⚠️ Próximos Passos (Não Implementados Ainda)

1. **Alertas em tempo real** - Notificar SUPERADMIN se admin faz >100 acessos/min
2. **Criptografia de logs** - Criptografar logs antes de armazenar
3. **Retenção de logs** - Deletar logs com +1 ano automaticamente
4. **Export de logs** - Baixar relatório de auditoria em CSV
5. **Dashboard** - UI visual dos acessos por admin

---

## 📝 Checklist de Implementação

- [x] Criar tabela AdminAuditLog
- [x] Criar AuditService
- [x] Criar Audit Decorator
- [x] Criar AuditInterceptor
- [x] Integrar no app.module
- [x] Atualizar user.controller com @Audit
- [x] Usar SELECT() explícito no user.service
- [x] Criar AuditController (ver logs)
- [x] Testar fluxo completo
- [ ] Criar testes unitários
- [ ] Criar dashboard de auditoria

---

## 🧪 Como Testar

### 1. Via cURL

```bash
# Fazer requisição autenticada como admin
curl -X GET "http://localhost:3000/api/user?page=1" \
  -H "Authorization: Bearer <JWT_TOKEN>"

# Verificar se foi auditada
curl -X GET "http://localhost:3000/api/admin/audit/sensitive-access" \
  -H "Authorization: Bearer <SUPERADMIN_TOKEN>"
```

### 2. Via Swagger

1. Ir para http://localhost:3000/api/docs
2. Autenticar com um token de ADMIN/SUPERADMIN
3. Executar: GET /user
4. Verificar resposta (agora com SELECT seguro)
5. Executar: GET /admin/audit/sensitive-access
6. Ver o log do acesso anterior

---

## 📞 Suporte

Se tiver dúvidas, consulte:
- `src/common/services/audit.service.ts` - Lógica principal
- `src/auth/decorators/audit.decorator.ts` - Como usar
- `src/common/interceptors/audit.interceptor.ts` - Como funciona
- `src/admin/audit.controller.ts` - Endpoints de auditoria

