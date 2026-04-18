create extension if not exists vector;

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  title text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(768),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists documents_source_id_idx
  on public.documents (source_id);

create index if not exists documents_embedding_idx
  on public.documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create or replace function public.match_documents(
  query_embedding vector(768),
  match_count int default 5,
  filter jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  source_id text,
  title text,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    documents.id,
    documents.source_id,
    documents.title,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) as similarity
  from public.documents
  where (
    not (filter ? 'sourceId')
    or documents.source_id = filter->>'sourceId'
  )
  and (
    not (filter ? 'sourceType')
    or documents.metadata->>'sourceType' = filter->>'sourceType'
  )
  order by documents.embedding <=> query_embedding
  limit match_count;
end;
$$;
