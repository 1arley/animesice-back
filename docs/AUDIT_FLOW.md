# 📊 Fluxo de Auditoria - Visualização

## Diagrama: Como a Auditoria Funciona

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🔐 ADMIN ACESSA: GET /api/user?page=1                              │
└─────────────────────────────────────────────────────────────────────┘
                           ↓
           ┌───────────────────────────────┐
           │  1. JwtAuthGuard               │
           │  ✓ Valida token JWT            │
           │  ✓ Extrai user info            │
           └───────────────────────────────┘
                           ↓
           ┌───────────────────────────────┐
           │  2. RolesGuard                 │
           │  ✓ Verifica se é ADMIN/SUPER   │
           │  ✗ Rejeita se for USER         │
           └───────────────────────────────┘
                           ↓
           ┌───────────────────────────────┐
           │  3. AuditInterceptor           │
           │  📝 COMEÇA A AUDITAR           │
           │  • Lê @Audit() decorator       │
           │  • action = "LIST_USERS"       │
           │  • resourceType = "User"       │
           └───────────────────────────────┘
                           ↓
           ┌───────────────────────────────┐
           │  4. UserController.findAll()   │
           │  Processa a requisição         │
           └───────────────────────────────┘
                           ↓
           ┌───────────────────────────────┐
           │  5. UserService.findAll()      │
           │  • SELECT explícito (seguro)   │
           │  • password NUNCA carregado    │
           │  • Retorna 5 usuários          │
           └───────────────────────────────┘
                           ↓
           ┌───────────────────────────────┐
           │  6. AuditInterceptor           │
           │  📝 REGISTRA NA DB             │
           │  INSERT INTO AdminAuditLog:    │
           │  {                             │
           │    adminId: "user-123",        │
           │    action: "LIST_USERS",       │
           │    ipAddress: "192.168.1.100", │
           │    dataAccessed: 5,            │
           │    status: "SUCCESS",          │
           │    createdAt: NOW()            │
           │  }                             │
           └───────────────────────────────┘
                           ↓
           ┌───────────────────────────────┐
           │  7. Resposta ao Admin          │
           │  {                             │
           │    data: [ ... 5 usuários ],   │
           │    meta: { total: 5 }          │
           │  }                             │
           └───────────────────────────────┘
```

---

## Tabela de Auditoria (AdminAuditLog)

```
┌────────┬──────────────────────────────────────────────────────────┐
│ Campo  │ Valor                                                    │
├────────┼──────────────────────────────────────────────────────────┤
│ id     │ 550e8400-e29b-41d4-a716-446655440000                   │
│ adminId│ arthuriarley323 (SUPERADMIN que fez o acesso)           │
│ action │ LIST_USERS                                               │
│ resource│ User                                                    │
│ resource│ null (não específico)                                  │
│ ipAddress│ 192.168.1.100 (IP de onde veio o acesso)             │
│ userAgent│ Mozilla/5.0... (browser do admin)                    │
│ status │ SUCCESS                                                  │
│ error  │ null                                                     │
│ data   │ 5 (quantos usuários foram acessados)                    │
│ created│ 2026-08-10 17:51:32 (hora exata do acesso)            │
└────────┴──────────────────────────────────────────────────────────┘
```

---

## Antes vs Depois

### ANTES (Sem Auditoria)

```
GET /api/user
├── ADMIN faz requisição
├── ✅ Token validado
├── ✅ Permissão verificada
├── ✅ Usuários retornados
└── ❌ NINGUÉM FICA SABENDO
    └── Admin poderia extrair emails
    └── Admin poderia fazer 1000x
    └── Admin poderia vender dados
    └── IMPOSSÍVEL RASTREAR
```

**Risco**: 🔴 CRÍTICO

### DEPOIS (Com Auditoria)

```
GET /api/user
├── ADMIN faz requisição
├── ✅ Token validado
├── ✅ Permissão verificada
├── ✅ Usuários retornados (com SELECT seguro)
├── 📝 AUDITADO AUTOMATICAMENTE
│   ├── IP capturado
│   ├── Hora registrada
│   ├── Browser salvo
│   ├── Quantidade de dados registrada
│   └── Tudo salvo no banco
└── ✅ RASTREÁVEL SEMPRE
    └── GET /admin/audit/sensitive-access mostra tudo
```

**Risco**: 🟢 CONTROLADO

---

## Exemplo: Detectar Admin Malicioso

### Cenário: Admin tenta extrair todos os emails

```bash
# Admin faz 100 requisições em 1 minuto
for i in {1..100}; do
  curl "http://localhost:3000/api/user?page=$i" \
    -H "Authorization: Bearer $TOKEN"
done
```

### O que a Auditoria Mostra

```sql
SELECT action, COUNT(*) as acessos, COUNT(DISTINCT HOUR(createdAt)) as minutos
FROM AdminAuditLog
WHERE adminId = 'admin-malicioso'
  AND action = 'LIST_USERS'
  AND createdAt > NOW() - INTERVAL 1 MINUTE
GROUP BY adminId;

-- Resultado:
┌──────────┬─────────┬────────┐
│ action   │ acessos │ minutos│
├──────────┼─────────┼────────┤
│ LIST_USERS│  100    │    1   │ ← ANOMALIA DETECTADA!
└──────────┴─────────┴────────┘
```

### Ação

```
🚨 ALERTA: Admin "arthuriarley323" fez 100 requisições em 1 minuto!
   IP: 192.168.1.100
   Browser: Mozilla/5.0...
   Data: 2026-08-10 17:55:00
   
   → Possível vazamento de dados
   → Desabilitar conta admin imediatamente?
```

---

## Endpoints de Auditoria

### 1. Ver Dados Sensíveis (Listagem de Usuários)

```http
GET /api/admin/audit/sensitive-access?resourceType=User&days=7
Authorization: Bearer <SUPERADMIN_TOKEN>

Response:
[
  {
    "id": "audit-1",
    "action": "LIST_USERS",
    "resourceType": "User",
    "admin": {
      "email": "arthuriarley323@gmail.com",
      "role": "SUPERADMIN"
    },
    "ipAddress": "192.168.1.100",
    "dataAccessed": 5,
    "status": "SUCCESS",
    "createdAt": "2026-08-10T17:50:00Z"
  }
]
```

### 2. Ver Histórico de um Admin (Em Futuros Controllers)

```http
GET /api/admin/audit/admin/:adminId/activity?limit=50
Authorization: Bearer <SUPERADMIN_TOKEN>

Response:
[
  { action: "LIST_USERS", createdAt: "...", ... },
  { action: "VIEW_USER", resourceId: "user-1", ... },
  { action: "LIST_USERS", createdAt: "...", ... },
  ...
]
```

---

## SELECT() Seguro Explicado

### ANTES (Inseguro)

```typescript
// ❌ PERIGO: password é carregado do banco
const users = await prisma.user.findMany({ skip, take });
// users[0] = { id, email, password: "bcrypt...", ... }

// Depois tenta remover
const safe = users.map(u => {
  const { password, ...rest } = u;
  return rest;  // ✅ OK aqui
});

// MAS se acontecer erro nessa linha:
console.log(safe);  // ❌ password pode ser logado!

// E se houver erro em parsing JSON:
return res.json(safe);  // ❌ password pode vazar!
```

### DEPOIS (Seguro)

```typescript
// ✅ SEGURO: password NUNCA é carregado
const users = await prisma.user.findMany({
  select: {
    id: true,
    email: true,
    name: true,
    role: true,
    // password não está aqui, então nunca é carregado
  },
});
// users[0] = { id, email, name, role }
// password = undefined (não existe no objeto)

// Agora é IMPOSSÍVEL vazar a senha:
console.log(safe);  // ✅ Seguro
return res.json(safe);  // ✅ Seguro
```

**Diferença Fundamental**:
- ANTES: Remove a senha DEPOIS
- DEPOIS: Nunca carrega a senha

---

## Sumário

| Aspecto | Antes | Depois |
|---------|-------|--------|
| **Rastreabilidade** | ❌ Nenhuma | ✅ Completa (IP, hora, browser) |
| **Investigação** | ❌ Impossível | ✅ Exato (sabe quem, quando, de onde) |
| **Prevenção** | ❌ Nenhuma | ✅ Efeito dissuasório |
| **Conformidade** | ❌ Violação LGPD | ✅ 100% Conforme |
| **Password** | ⚠️ Risco de vazar | ✅ Nunca carregado |
| **Performance** | ✅ Nenhum impacto | ✅ SELECT mais eficiente |

---

**Próximo passo**: Executar `npx prisma migrate deploy` e testar! 🚀
