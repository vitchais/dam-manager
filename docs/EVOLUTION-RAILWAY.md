# Evolution API no Railway

A Evolution API é a ponte entre o WhatsApp e o nosso servidor. Ela roda como um
**serviço separado** no Railway, ao lado da aplicação `dam-manager`.

No fim deste guia você terá dois serviços no mesmo projeto Railway:

```
Projeto Railway "DAM"
├── dam-manager      ← este repositório (site + painel + chatbot)
├── evolution-api    ← imagem Docker pronta
└── Postgres         ← banco interno da Evolution (não é o Supabase)
```

> A Evolution guarda as sessões do WhatsApp no **Postgres dela**. Isso é
> separado do Supabase, que guarda as reservas. Não misture os dois.

---

## Passo 1 — Criar o serviço da Evolution API

1. No projeto do Railway: **New** → **Docker Image**
2. Imagem: `atendai/evolution-api:v2.1.1`
3. Aguarde o primeiro deploy (ele vai falhar até você preencher as variáveis —
   isso é normal).

## Passo 2 — Criar o Postgres da Evolution

1. **New** → **Database** → **Add PostgreSQL**
2. Não precisa configurar nada: vamos referenciar a variável dele no passo 3.

## Passo 3 — Variáveis do serviço `evolution-api`

Abra o serviço **evolution-api** → aba **Variables** → **Raw Editor** e cole:

```bash
# Servidor
SERVER_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}

# Chave mestra da API. TROQUE por um valor aleatório seu:
#   openssl rand -hex 32
AUTHENTICATION_API_KEY=COLE_AQUI_UMA_CHAVE_ALEATORIA

# Banco de dados (referencia o Postgres criado no passo 2)
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=${{Postgres.DATABASE_URL}}
DATABASE_CONNECTION_CLIENT_NAME=evolution

# O que persistir
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true
DATABASE_SAVE_DATA_LABELS=false
DATABASE_SAVE_DATA_HISTORIC=false

# Cache local (dispensa Redis num volume de mensagens pequeno como o do DAM)
CACHE_REDIS_ENABLED=false
CACHE_LOCAL_ENABLED=true

# Não apagar a instância quando o WhatsApp cair — senão você teria que
# reescanear o QR Code toda vez que a internet do bar oscilasse.
DEL_INSTANCE=false

# Logs
LOG_LEVEL=ERROR,WARN,INFO
LOG_COLOR=true
LOG_BAILEYS=error

# Telemetria desligada
TELEMETRY_ENABLED=false
```

> **Guarde o valor de `AUTHENTICATION_API_KEY`.** Ele vira o
> `EVOLUTION_API_KEY` do serviço `dam-manager`.

## Passo 4 — Gerar o domínio público

1. Serviço **evolution-api** → **Settings** → **Networking** → **Generate Domain**
2. Porta: **8080**
3. Copie a URL gerada (algo como `https://evolution-api-production-xxxx.up.railway.app`).
   Ela vira o `EVOLUTION_API_URL` do serviço `dam-manager`.

## Passo 5 — Volume (recomendado)

Serviço **evolution-api** → **Settings** → **Volumes** → **Add Volume**
Caminho: `/evolution/instances`

Sem volume, cada redeploy perde os arquivos de sessão e você precisa
escanear o QR Code de novo.

---

## Passo 6 — Variáveis do serviço `dam-manager`

Agora no serviço da aplicação, aba **Variables**:

```bash
NODE_ENV=production
APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
TZ=America/Cuiaba

SUPABASE_URL=https://sfrovrevzqrfrmmlmpyi.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...        # Supabase → Settings → API
OPENAI_API_KEY=...                   # platform.openai.com/api-keys
OPENAI_MODEL=gpt-4o-mini

EVOLUTION_API_URL=https://...        # URL do passo 4, SEM barra no final
EVOLUTION_API_KEY=...                # AUTHENTICATION_API_KEY do passo 3
EVOLUTION_INSTANCE=dam
WEBHOOK_TOKEN=...                    # openssl rand -hex 32

ADMIN_PASSWORD=...                   # senha do painel

CASA_NOME=DAM Gastrobar
CASA_TELEFONE=5565993378770
CASA_ENDERECO=...
CASA_HORARIO=...
CASA_CAPACIDADE_MAXIMA=120
```

Não defina `PORT` — o Railway injeta sozinho.

---

## Passo 7 — Conectar o WhatsApp

Com os dois serviços no ar, rode **na sua máquina**, com um `.env` local
apontando para a Evolution de produção:

```bash
npm run setup:evolution
```

O script:
1. cria a instância `dam`;
2. aponta o webhook para `APP_URL/webhook/evolution?token=...`;
3. salva `qrcode-whatsapp.png` na pasta do projeto.

Abra o PNG e escaneie:
**WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho**

Confirme com:

```bash
npm run check
```

Ou abra `https://<seu-app>.up.railway.app/status` no navegador.

### Alternativa pelo navegador

Se preferir não rodar o script, use o Manager que vem com a Evolution:
`https://<evolution>.up.railway.app/manager` — entre com a
`AUTHENTICATION_API_KEY`, crie a instância `dam`, escaneie o QR e cadastre o
webhook manualmente apontando para
`https://<seu-app>.up.railway.app/webhook/evolution?token=<WEBHOOK_TOKEN>`
com os eventos `MESSAGES_UPSERT` e `CONNECTION_UPDATE`.

---

## Qual número usar

Use um chip **dedicado** ao bot, não o WhatsApp pessoal de quem trabalha na casa.
A Evolution conecta como "aparelho conectado" (WhatsApp Web). Se o mesmo número
for usado no celular ao mesmo tempo, tudo bem — mas o bot vai responder qualquer
mensagem que chegar, inclusive de conhecidos.

Se hoje o número `5565993378770` (o do site) for usado por uma pessoa, considere:
- **opção A:** dedicar esse número ao bot e mover o atendimento humano para outro;
- **opção B:** conectar o bot num número novo e trocar o link do site.

Em qualquer caso, coloque os números que o bot **não** deve responder em
`CHATBOT_IGNORE_NUMBERS`.

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Webhook nunca chega | `APP_URL` errada, ou webhook cadastrado sem o `?token=` |
| `401` nos logs do webhook | `WEBHOOK_TOKEN` diferente entre a URL e a variável |
| QR Code expira toda hora | Falta o volume do passo 5 |
| Instância some após redeploy | `DEL_INSTANCE` está `true` |
| `Cannot connect to database` | `DATABASE_CONNECTION_URI` não está referenciando o Postgres |
| Bot responde a si mesmo | Não deve acontecer: filtramos `fromMe`. Se acontecer, confira se há outro webhook antigo cadastrado |
