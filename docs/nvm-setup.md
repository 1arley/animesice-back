# Gerenciando a versão do Node.js com NVM

Este projeto utiliza [NVM (Node Version Manager)](https://github.com/nvm-sh/nvm) para garantir que todos os desenvolvedores e ambientes de produção usem a mesma versão do Node.js. A versão recomendada é **Node.js 20**, alinhada aos requisitos do NestJS 11.

- **NVM** instalado no sistema

### Instalando o NVM

**Linux / macOS:**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

Reinicie o terminal ou execute `source ~/.bashrc` (ou `source ~/.zshrc`).

**Windows:**

Use [nvm-windows](https://github.com/coreybutler/nvm-windows):

1. Baixe o instalador mais recente em: https://github.com/coreybutler/nvm-windows/releases
2. Siga o assistente de instalação
3. Abra um novo terminal

## Utilizando

### Instalar e usar a versão correta

```bash
nvm install
nvm use
```

> [!NOTE]
> `nvm install` sem argumentos lê automaticamente o `.nvmrc` e instala a versão especificada.

## Verificando a versão

```bash
node --version
```

Certifique-se de que a versão exibida é igual ao arquivo `.nvmrc`.
