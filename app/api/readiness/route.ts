import { ZodError } from "zod";
import { NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { verifyGeminiConnection } from "@/lib/gemini";
import { verifyNeo4jConnection } from "@/lib/neo4j";
import { verifySupabaseConnection } from "@/lib/supabase";
import type { ReadinessCheck, ReadinessResponse } from "@/lib/types";

export const runtime = "nodejs";

function deriveOverallStatus(checks: ReadinessCheck[]): ReadinessResponse["status"] {
  if (checks.some((check) => check.status === "error")) {
    return "not_ready";
  }
  if (checks.some((check) => check.status === "warning")) {
    return "degraded";
  }
  return "ready";
}

export async function GET() {
  const checks: ReadinessCheck[] = [];

  try {
    const env = getServerEnv();
    checks.push({
      name: "Environment",
      status: "ok",
      message: `Required server variables are present for ${env.NEO4J_DATABASE}.`
    });
  } catch (error) {
    const message =
      error instanceof ZodError
        ? `Missing or invalid environment values: ${error.issues.map((issue) => issue.path.join(".")).join(", ")}`
        : error instanceof Error
          ? error.message
          : "Unknown environment validation failure.";

    checks.push({
      name: "Environment",
      status: "error",
      message
    });

    return NextResponse.json(
      {
        status: "not_ready",
        checkedAt: new Date().toISOString(),
        checks
      } satisfies ReadinessResponse,
      { status: 500 }
    );
  }

  const results = await Promise.allSettled([
    verifyGeminiConnection(),
    verifySupabaseConnection(),
    verifyNeo4jConnection()
  ]);

  const [geminiResult, supabaseResult, neo4jResult] = results;

  checks.push(
    geminiResult.status === "fulfilled"
      ? {
          name: "Gemini",
          status: "ok",
          message: `Embedding request succeeded with ${geminiResult.value} dimensions returned.`
        }
      : {
          name: "Gemini",
          status: "error",
          message: geminiResult.reason instanceof Error ? geminiResult.reason.message : "Gemini check failed."
        }
  );

  checks.push(
    supabaseResult.status === "fulfilled"
      ? {
          name: "Supabase",
          status: "ok",
          message: `Supabase responded to a documents query${supabaseResult.value > 0 ? ` with ${supabaseResult.value} sampled row(s).` : "."}`
        }
      : {
          name: "Supabase",
          status: "error",
          message: supabaseResult.reason instanceof Error ? supabaseResult.reason.message : "Supabase check failed."
        }
  );

  checks.push(
    neo4jResult.status === "fulfilled"
      ? {
          name: "Neo4j",
          status: "ok",
          message: "Neo4j connectivity and a simple query both succeeded."
        }
      : {
          name: "Neo4j",
          status: "error",
          message: neo4jResult.reason instanceof Error ? neo4jResult.reason.message : "Neo4j check failed."
        }
  );

  const payload = {
    status: deriveOverallStatus(checks),
    checkedAt: new Date().toISOString(),
    checks
  } satisfies ReadinessResponse;

  return NextResponse.json(payload, {
    status: payload.status === "ready" ? 200 : 503
  });
}
