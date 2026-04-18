import { z } from "zod";

const serverEnvSchema = z.object({
  GOOGLE_AI_API_KEY: z.string().min(1),
  GOOGLE_TEXT_MODEL: z.string().min(1).default("gemini-2.0-flash"),
  GOOGLE_EMBEDDING_MODEL: z.string().min(1).default("gemini-embedding-001"),
  NEO4J_URI: z.string().url(),
  NEO4J_USERNAME: z.string().min(1),
  NEO4J_PASSWORD: z.string().min(1),
  NEO4J_DATABASE: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1)
});

let cachedEnv: z.infer<typeof serverEnvSchema> | null = null;

export function getServerEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = serverEnvSchema.parse(process.env);
  return cachedEnv;
}
