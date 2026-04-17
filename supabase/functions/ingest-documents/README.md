# ingest-documents

This Supabase Edge Function accepts raw text and performs the ingestion pipeline:

1. chunk text
2. extract entities and triplets with Gemini
3. upsert graph relationships into Neo4j
4. generate embeddings
5. insert chunk rows into `documents`

## Request body

```json
{
  "sourceId": "acme-strategy-pdf",
  "title": "Acme Strategy Deck",
  "text": "Full document text goes here",
  "metadata": {
    "sourceType": "pdf"
  }
}
```

## Local serve

```bash
supabase functions serve ingest-documents --env-file supabase/.env.local
```

## Deploy

```bash
supabase functions deploy ingest-documents
```
