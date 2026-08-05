-- ============================================================================
-- DAM MANAGER — esquema do banco (Supabase / PostgreSQL)
--
-- Como aplicar:
--   Supabase → SQL Editor → New query → cole este arquivo inteiro → Run.
--
-- O script é idempotente: pode ser rodado de novo sem quebrar nada.
--
-- MODELO DE SEGURANÇA
--   RLS fica LIGADO em todas as tabelas e NENHUMA política é criada para os
--   papéis `anon` e `authenticated`. Ou seja: a chave pública do navegador não
--   lê nada. Todo acesso passa pelo nosso servidor Node, que usa a chave
--   `service_role` (que ignora RLS) e exige senha no painel administrativo.
--
--   Isso é proposital. Telefone e nome de cliente são dados pessoais (LGPD);
--   com política de leitura para `anon`, qualquer pessoa que abrisse o código
--   da página conseguiria baixar a lista inteira de clientes.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- CLIENTES
-- ----------------------------------------------------------------------------
create table if not exists public.clientes (
    id           uuid primary key default gen_random_uuid(),
    nome         text,
    -- Somente dígitos, com DDI. Ex.: 5565993378770
    telefone     text not null,
    criado_em    timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
);

-- Um cliente por número: é assim que o bot reconhece quem está falando.
create unique index if not exists clientes_telefone_key
    on public.clientes (telefone);

-- ----------------------------------------------------------------------------
-- RESERVAS
-- ----------------------------------------------------------------------------
create table if not exists public.reservas (
    id            uuid primary key default gen_random_uuid(),
    cliente_id    uuid not null,
    data_reserva  date not null,
    horario       time not null,
    pessoas       integer not null check (pessoas > 0 and pessoas <= 200),
    ambiente_pref text,
    observacoes   text,
    status        text not null default 'Pendente'
                  check (status in ('Pendente', 'Confirmada', 'Cancelada')),
    -- De onde veio a reserva: 'whatsapp' (bot), 'painel', 'site'.
    origem        text not null default 'whatsapp',
    criado_em     timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
);

-- O nome desta constraint importa: o painel faz o join com a sintaxe
-- `clientes!reservas_cliente_id_fkey(...)`, que referencia a FK pelo nome.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'reservas_cliente_id_fkey'
    ) then
        alter table public.reservas
            add constraint reservas_cliente_id_fkey
            foreign key (cliente_id) references public.clientes (id)
            on delete cascade;
    end if;
end $$;

create index if not exists reservas_data_idx
    on public.reservas (data_reserva, horario);
create index if not exists reservas_cliente_idx
    on public.reservas (cliente_id);
create index if not exists reservas_status_idx
    on public.reservas (status);

-- Trava a reserva duplicada: mesmo cliente, mesmo dia, mesmo horário.
-- Reserva cancelada não conta, senão o cliente não conseguiria remarcar.
create unique index if not exists reservas_sem_duplicata_idx
    on public.reservas (cliente_id, data_reserva, horario)
    where status <> 'Cancelada';

-- ----------------------------------------------------------------------------
-- CONVERSAS E MENSAGENS (memória do chatbot)
-- ----------------------------------------------------------------------------
create table if not exists public.conversas (
    id               uuid primary key default gen_random_uuid(),
    cliente_id       uuid references public.clientes (id) on delete cascade,
    telefone         text not null,
    -- 'bot' = respondendo automático; 'humano' = atendente assumiu, bot cala.
    modo             text not null default 'bot'
                     check (modo in ('bot', 'humano')),
    ultima_interacao timestamptz not null default now(),
    criado_em        timestamptz not null default now()
);

create unique index if not exists conversas_telefone_key
    on public.conversas (telefone);

create table if not exists public.mensagens (
    id          uuid primary key default gen_random_uuid(),
    conversa_id uuid not null references public.conversas (id) on delete cascade,
    -- 'user' = cliente, 'assistant' = bot, 'system' = nota interna.
    papel       text not null check (papel in ('user', 'assistant', 'system')),
    conteudo    text not null,
    -- ID da mensagem no WhatsApp. Serve para não processar o mesmo evento duas
    -- vezes quando a Evolution reenvia o webhook.
    wa_id       text,
    criado_em   timestamptz not null default now()
);

create index if not exists mensagens_conversa_idx
    on public.mensagens (conversa_id, criado_em);

create unique index if not exists mensagens_wa_id_key
    on public.mensagens (wa_id) where wa_id is not null;

-- ----------------------------------------------------------------------------
-- EVENTOS (programação da casa — o bot consulta para responder "quem toca hoje")
-- ----------------------------------------------------------------------------
create table if not exists public.eventos (
    id        uuid primary key default gen_random_uuid(),
    data      date not null,
    titulo    text not null,
    atracao   text,
    descricao text,
    criado_em timestamptz not null default now()
);

create index if not exists eventos_data_idx on public.eventos (data);

-- ----------------------------------------------------------------------------
-- atualizado_em automático
-- ----------------------------------------------------------------------------
create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
    new.atualizado_em = now();
    return new;
end;
$$;

drop trigger if exists clientes_atualizado_em on public.clientes;
create trigger clientes_atualizado_em
    before update on public.clientes
    for each row execute function public.tocar_atualizado_em();

drop trigger if exists reservas_atualizado_em on public.reservas;
create trigger reservas_atualizado_em
    before update on public.reservas
    for each row execute function public.tocar_atualizado_em();

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
--
-- Ligado em tudo, sem nenhuma política para anon/authenticated. Resultado:
-- leitura e escrita são negadas por padrão para as chaves públicas.
-- A chave `service_role` usada pelo servidor não é afetada por RLS.
-- ----------------------------------------------------------------------------
alter table public.clientes  enable row level security;
alter table public.reservas  enable row level security;
alter table public.conversas enable row level security;
alter table public.mensagens enable row level security;
alter table public.eventos   enable row level security;

-- A programação é informação pública do site — esta é a única exceção.
drop policy if exists "eventos legíveis publicamente" on public.eventos;
create policy "eventos legíveis publicamente"
    on public.eventos for select
    to anon, authenticated
    using (true);

-- Remove políticas permissivas que possam ter sobrado de configurações antigas
-- (uma política "allow all" em `reservas` vazaria a base inteira de clientes).
do $$
declare
    politica record;
begin
    for politica in
        select policyname, tablename
        from pg_policies
        where schemaname = 'public'
          and tablename in ('clientes', 'reservas', 'conversas', 'mensagens')
    loop
        execute format(
            'drop policy if exists %I on public.%I',
            politica.policyname, politica.tablename
        );
    end loop;
end $$;
