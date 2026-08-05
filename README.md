# DAM Manager

Site, painel de reservas e chatbot de WhatsApp do **DAM Gastrobar** (Cuiabá/MT).

Um único processo Node serve tudo:

| Rota | O que é |
|---|---|
| `/` | Site do DAM (`index.html`, intocado) |
| `/admin.html` | Painel de reservas, protegido por senha |
| `/whatsapp.html` | Conectar o WhatsApp (QR Code), protegido por senha |
| `/api/*` | API do painel |
| `/webhook/evolution` | Entrada das mensagens de WhatsApp |
| `/health` | Checagem usada pelo Railway |
| `/status` | Diagnóstico: o que está configurado, o que falta |

## Como funciona o chatbot

```
Cliente no WhatsApp
        │
        ▼
  Evolution API  (serviço separado no Railway — conecta o número)
        │  webhook
        ▼
  dam-manager  ──►  OpenAI (decide o que fazer)
        │                │
        │                └─► ferramentas: consultar disponibilidade,
        │                    criar reserva, cancelar, ver programação
        ▼
     Supabase  (clientes, reservas, histórico das conversas)
        │
        ▼
   Painel /admin.html  (a equipe confirma ou cancela)
```

---

## Rodando localmente

```bash
npm install
cp .env.example .env
npm run dev
```

O servidor sobe em <http://localhost:3000> **mesmo sem credenciais**. O que
faltar aparece como aviso no console e o recurso correspondente fica desligado.
Para ver o relatório completo a qualquer momento:

```bash
npm run check
```

### Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe com reload automático |
| `npm start` | Sobe em modo produção |
| `npm run check` | Testa cada credencial de verdade e lista o que falta |
| `npm run setup:evolution` | Cria a instância, configura o webhook e gera o QR Code |

---

## Configuração

Todas as variáveis estão documentadas em [`.env.example`](.env.example).
As que **você precisa providenciar**:

| Variável | Onde conseguir |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` |
| `OPENAI_API_KEY` | <https://platform.openai.com/api-keys> |
| `EVOLUTION_API_URL` | URL do serviço Evolution no Railway |
| `EVOLUTION_API_KEY` | `AUTHENTICATION_API_KEY` do serviço Evolution |
| `WEBHOOK_TOKEN` | Gere você: `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | Defina uma senha forte |
| `APP_URL` | URL pública do app no Railway |

---

## Banco de dados

Aplique o esquema uma vez:

**Supabase → SQL Editor → New query** → cole [`supabase/schema.sql`](supabase/schema.sql) → **Run**

Tabelas criadas: `clientes`, `reservas`, `conversas`, `mensagens`, `eventos`.

### Sobre segurança

RLS fica ligado em todas as tabelas e **nenhuma política de leitura é criada
para as chaves públicas**. Só o servidor acessa o banco, usando a chave
`service_role`.

Isso é uma mudança em relação à versão anterior, em que o painel falava direto
com o Supabase usando a chave pública embutida no JavaScript — qualquer pessoa
que abrisse o código-fonte da página conseguiria baixar a lista completa de
clientes com nome e telefone.

---

## Deploy

- **Aplicação + chatbot:** Railway. Ver [`docs/EVOLUTION-RAILWAY.md`](docs/EVOLUTION-RAILWAY.md).
- **Só o site estático:** os arquivos continuam na raiz do repositório, então a
  publicação atual na Vercel segue funcionando sem nenhuma mudança de config.
  Nessa modalidade, porém, painel, API e chatbot **não** funcionam — eles
  precisam do servidor Node.

---

## Estrutura

```
index.html         site do DAM (não tocado por esta integração)
admin.html         painel de reservas
whatsapp.html      conectar o número
css/ js/           recursos do painel
src/
  server.js        Express: estático + API + webhook
  config/env.js    leitura e validação das variáveis de ambiente
  lib/             supabase, openai, evolution, datas, logger
  services/        regras de reserva, memória da conversa, o agente
  routes/          webhook, api do painel, health/status
supabase/          schema.sql
scripts/           check-config.js, setup-evolution.js
docs/              guia de deploy da Evolution API
```
