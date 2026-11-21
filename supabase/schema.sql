-- AI QA · експертне рецензування лонгрідів
-- Запустити один раз у Supabase → SQL Editor.
-- Ключі доступу додаються ОКРЕМО (не зберігайте їх у публічному репозиторії):
--   insert into qa_keys(key, role, label) values ('<довгий-випадковий-ключ>', 'admin', 'Vale');
--   insert into qa_keys(key, role, label) values ('<інший-ключ>', 'reviewer', 'Експерт');

create extension if not exists pgcrypto;

create table if not exists qa_keys (
  key   text primary key,
  role  text not null check (role in ('admin','reviewer')),
  label text
);

create table if not exists qa_comments (
  id         uuid primary key default gen_random_uuid(),
  doc        text not null,
  parent_id  uuid references qa_comments(id) on delete cascade,
  author     text not null,
  client_id  text,
  quote      text,
  prefix     text,
  suffix     text,
  section    text,
  body       text not null,
  status     text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists qa_comments_doc_idx on qa_comments(doc, created_at);

-- Прямий доступ до таблиць закритий; усе йде через функції нижче.
alter table qa_keys     enable row level security;
alter table qa_comments enable row level security;

create or replace function qa_role(p_key text) returns text
language sql stable security definer set search_path = public as
$$ select role from qa_keys where key = p_key $$;

create or replace function qa_login(p_key text) returns text
language plpgsql stable security definer set search_path = public as $$
declare r text := qa_role(p_key);
begin
  if r is null then raise exception 'not allowed'; end if;
  return r;
end $$;

create or replace function qa_list(p_key text, p_doc text)
returns setof qa_comments
language plpgsql stable security definer set search_path = public as $$
begin
  if qa_role(p_key) is null then raise exception 'not allowed'; end if;
  return query select * from qa_comments where doc = p_doc order by created_at;
end $$;

create or replace function qa_add(
  p_key text, p_doc text, p_parent uuid, p_author text, p_client text,
  p_quote text, p_prefix text, p_suffix text, p_section text, p_body text)
returns qa_comments
language plpgsql security definer set search_path = public as $$
declare c qa_comments;
begin
  if qa_role(p_key) is null then raise exception 'not allowed'; end if;
  if coalesce(trim(p_body),'') = '' then raise exception 'empty'; end if;
  insert into qa_comments(doc,parent_id,author,client_id,quote,prefix,suffix,section,body)
  values (p_doc,p_parent,left(p_author,80),p_client,left(p_quote,4000),left(p_prefix,200),
          left(p_suffix,200),left(p_section,300),left(p_body,10000))
  returning * into c;
  return c;
end $$;

create or replace function qa_edit(p_key text, p_id uuid, p_client text, p_body text)
returns void
language plpgsql security definer set search_path = public as $$
declare r text := qa_role(p_key);
begin
  if r is null then raise exception 'not allowed'; end if;
  update qa_comments set body = left(p_body,10000), updated_at = now()
   where id = p_id and (r = 'admin' or client_id = p_client);
end $$;

create or replace function qa_set_status(p_key text, p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if qa_role(p_key) is null then raise exception 'not allowed'; end if;
  update qa_comments set status = p_status, updated_at = now() where id = p_id;
end $$;

create or replace function qa_delete(p_key text, p_id uuid, p_client text)
returns void
language plpgsql security definer set search_path = public as $$
declare r text := qa_role(p_key);
begin
  if r is null then raise exception 'not allowed'; end if;
  delete from qa_comments where id = p_id and (r = 'admin' or client_id = p_client);
end $$;

revoke all on qa_keys, qa_comments from anon, authenticated;
grant execute on function qa_login(text), qa_list(text,text),
  qa_add(text,text,uuid,text,text,text,text,text,text,text),
  qa_edit(text,uuid,text,text), qa_set_status(text,uuid,text),
  qa_delete(text,uuid,text) to anon, authenticated;
revoke execute on function qa_role(text) from anon, authenticated, public;
