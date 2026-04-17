import neo4j, { type Driver, type ManagedTransaction, type Record as Neo4jRecord } from "neo4j-driver";
import type { GraphLink, GraphNode, GraphPath, GraphPayload, Triplet } from "@/lib/types";
import { getServerEnv } from "@/lib/env";

type Neo4jPathSegment = {
  start: {
    properties: {
      name: string;
    };
  };
  end: {
    properties: {
      name: string;
    };
  };
  relationship: {
    properties: {
      type?: string;
    };
  };
};

type Neo4jPath = {
  segments: Neo4jPathSegment[];
};

let cachedDriver: Driver | null = null;

function getDriver() {
  if (cachedDriver) {
    return cachedDriver;
  }

  const env = getServerEnv();
  cachedDriver = neo4j.driver(env.NEO4J_URI, neo4j.auth.basic(env.NEO4J_USERNAME, env.NEO4J_PASSWORD));
  return cachedDriver;
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function upsertTriplets(triplets: Triplet[]) {
  if (triplets.length === 0) {
    return;
  }

  const env = getServerEnv();
  const session = getDriver().session({ database: env.NEO4J_DATABASE });

  try {
    await session.executeWrite((tx: ManagedTransaction) =>
      tx.run(
        `
          UNWIND $triplets AS triplet
          MERGE (a:Entity {name: triplet.subject})
          MERGE (b:Entity {name: triplet.object})
          MERGE (a)-[r:RELATED {type: triplet.relation}]->(b)
        `,
        { triplets }
      )
    );
  } finally {
    await session.close();
  }
}

export async function fetchGraphContext(entityNames: string[]) {
  if (entityNames.length === 0) {
    return {
      nodes: [],
      links: [],
      paths: [],
      relatedEntities: []
    } satisfies GraphPayload;
  }

  const env = getServerEnv();
  const session = getDriver().session({ database: env.NEO4J_DATABASE });
  const loweredNames = entityNames.map((entity) => entity.toLowerCase());

  try {
    const neighborResult = await session.executeRead((tx: ManagedTransaction) =>
      tx.run(
        `
          MATCH (a:Entity)-[r:RELATED]->(b:Entity)
          WHERE toLower(a.name) IN $names OR toLower(b.name) IN $names
          RETURN a.name AS source, b.name AS target, r.type AS relation
          LIMIT 40
        `,
        { names: loweredNames }
      )
    );

    const links: GraphLink[] = neighborResult.records.map((record: Neo4jRecord) => ({
      source: record.get("source") as string,
      target: record.get("target") as string,
      relation: (record.get("relation") as string) || "RELATED"
    }));

    const pathRecords: GraphPath[] = [];
    const distinctEntities = Array.from(new Set(entityNames));
    if (distinctEntities.length >= 2) {
      const [start, end] = distinctEntities;
      const shortestPathResult = await session.executeRead((tx: ManagedTransaction) =>
        tx.run(
          `
            MATCH (a:Entity), (b:Entity)
            WHERE toLower(a.name) = toLower($start)
              AND toLower(b.name) = toLower($end)
            MATCH p = shortestPath((a)-[:RELATED*..4]-(b))
            RETURN p
            LIMIT 1
          `,
          { start, end }
        )
      );

      const path = shortestPathResult.records[0]?.get("p") as Neo4jPath | undefined;
      if (path) {
        const nodes = path.segments.flatMap((segment, index) =>
          index === 0
            ? [segment.start.properties.name, segment.end.properties.name]
            : [segment.end.properties.name]
        );
        const relationships = path.segments.map(
          (segment) => segment.relationship.properties.type || "RELATED"
        );
        pathRecords.push({ nodes, relationships });
      }
    }

    const pathLinks = pathRecords.flatMap((path) =>
      path.relationships.map((relation, index) => ({
        source: path.nodes[index],
        target: path.nodes[index + 1],
        relation,
        highlighted: true
      }))
    );

    const baseQueryNodes: GraphNode[] = entityNames.map((entityName) => ({
      id: entityName,
      label: entityName,
      group: "query",
      highlighted: true
    }));

    const nodes: GraphNode[] = uniqueBy(
      [...baseQueryNodes, ...[...links, ...pathLinks].flatMap((link) => [
        {
          id: link.source,
          label: link.source,
          group: entityNames.includes(link.source) ? "query" : "neighbor",
          highlighted: entityNames.includes(link.source)
        },
        {
          id: link.target,
          label: link.target,
          group: entityNames.includes(link.target) ? "query" : "neighbor",
          highlighted: entityNames.includes(link.target)
        }
      ])],
      (node) => node.id
    );

    return {
      nodes,
      links: uniqueBy([...links, ...pathLinks], (link) => `${link.source}|${link.relation}|${link.target}`),
      paths: pathRecords,
      relatedEntities: entityNames
    } satisfies GraphPayload;
  } finally {
    await session.close();
  }
}
