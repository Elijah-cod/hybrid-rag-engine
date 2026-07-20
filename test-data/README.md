# InsightGraph Test Data Pack

Use these fixtures to test ingestion, semantic retrieval, graph traversal, source scoping, and answer synthesis without using private or production data.

## Quick Test Order

1. Select **Mock AI** so the run does not use Gemini quota.
2. Open **Data Sources** and ingest the fixtures in the order below.
3. Keep each generated source ID. The file uploader should create a unique ID from each filename.
4. Open **Query Engine**, choose **Hybrid**, and ask the suggested questions.
5. Compare the answer, semantic evidence, nodes, links, and graph paths with the expected results.
6. Repeat selected questions in **Vector** and **Graph** modes to confirm each retrieval path behaves differently.

## Fixture Matrix

| Fixture | Format | Primary behavior tested |
| --- | --- | --- |
| `01-orion-launch-plan.txt` | TXT | Direct and multi-hop project dependencies |
| `02-cloud-incident-review.md` | Markdown | People, teams, systems, and incident ownership |
| `03-customer-success-network.json` | JSON | Top-level JSON content extraction and cross-functional links |
| `04-global-supply-chain.csv` | CSV | Tabular upload and repeated entity relationships |
| `../output/pdf/05-harbor-city-climate-plan.pdf` | PDF | Real PDF text extraction and a longer multi-section document |
| `06-conflicting-records.txt` | TXT | Conflicting claims, disconnected entities, and cautious answers |

## 1. Orion Launch Plan

Suggested questions:

- How is Project Orion connected to the October Launch?
- Which teams support Project Orion?
- What does the Identity Platform depend on?
- Who reviews the Orion Readiness Board?

Expected highlights:

- `Project Orion -> DEPENDS_ON -> Identity Platform`
- `Identity Platform -> DEPENDS_ON -> Atlas Authentication Service`
- `Launch Operations Team -> SUPPORTS -> Project Orion`
- `Priya Njeri -> REVIEWS -> Orion Readiness Board`

## 2. Cloud Incident Review

Suggested questions:

- How is Checkout API connected to Northstar Payments Team?
- Which system depends on Redis Cluster?
- Who is responsible for the Incident Recovery Program?
- What does Observability Guild support?

Expected highlights:

- `Checkout API -> DEPENDS_ON -> Redis Cluster`
- `Northstar Payments Team -> RESPONSIBLE_FOR -> Checkout API`
- `Observability Guild -> SUPPORTS -> Incident Recovery Program`
- `Marcus Lee -> REVIEWS -> Recovery Scorecard`

## 3. Customer Success Network

Suggested questions:

- How is Acme Health connected to Renewal Program?
- Which team supports Acme Health?
- Who owns the Customer Data Hub?
- What does Customer Data Hub use?

Expected highlights:

- `Acme Health -> USES -> Pulse Analytics`
- `Enterprise Success Team -> SUPPORTS -> Acme Health`
- `Customer Data Hub -> OWNED_BY -> Data Products Team`
- `Customer Data Hub -> USES -> Supabase Warehouse`

## 4. Global Supply Chain

Suggested questions:

- How is Nairobi Assembly Hub connected to Solar Sensor Program?
- Which supplier supports the Solar Sensor Program?
- What depends on Mombasa Logistics Corridor?
- Who reviews the Supplier Risk Board?

Expected highlights:

- `Nairobi Assembly Hub -> SUPPORTS -> Solar Sensor Program`
- `Solar Sensor Program -> DEPENDS_ON -> Mombasa Logistics Corridor`
- `Kijani Components -> PARTNERS_WITH -> Nairobi Assembly Hub`
- `Amina Otieno -> REVIEWS -> Supplier Risk Board`

## 5. Harbor City Climate Plan

Suggested questions:

- How is Blue Transit Program connected to Harbor City Council?
- Which initiative depends on Coastal Battery Network?
- Who is responsible for the Climate Delivery Office?
- What supports the Net Zero 2030 Goals?

Expected highlights:

- `Blue Transit Program -> SPONSORED_BY -> Harbor City Council`
- `Blue Transit Program -> DEPENDS_ON -> Coastal Battery Network`
- `Elena Marquez -> RESPONSIBLE_FOR -> Climate Delivery Office`
- `Urban Forestry Initiative -> SUPPORTS -> Net Zero 2030 Goals`

## 6. Conflicting Records

This fixture deliberately contains disagreement and one disconnected topic. It tests whether an answer shows uncertainty instead of inventing a resolution.

Suggested questions:

- Who owns Mercury Migration Program?
- What systems does Mercury Migration Program depend on?
- Is Polar Research Lab connected to Mercury Migration Program?

Expected behavior:

- The graph may show both `Platform Engineering Team` and `Finance Systems Team` as owners because the source conflicts with itself.
- The answer should mention both claims rather than silently choosing one.
- `Polar Research Lab` should not have a path to `Mercury Migration Program`.

## Mode Checks

- **Hybrid** should return semantic evidence and graph structure together.
- **Vector** should prioritize chunks containing similar terms and should skip graph traversal.
- **Graph** should emphasize nodes, edges, and paths; a weak or absent path should be visible rather than fabricated.
- **Source scope** should prevent evidence from unrelated fixtures from appearing in an answer.

## What Success Looks Like

- Every file upload returns readable text and a source ID based on its filename.
- The Source Library shows a unique title and source ID for each fixture.
- Ingestion reports at least one chunk, entity, and relationship for each fixture.
- The Knowledge Map displays connected nodes for the direct relationship questions.
- A multi-hop question shows more than one edge when the relevant intermediate entities were retrieved.
- Removing source scope allows cross-document retrieval; applying source scope limits evidence to one fixture.
- Duplicate ingestion updates the same source instead of creating confusing `strategy-memo` entries.
- The contradictory fixture produces inspectable competing relationships instead of a falsely certain answer.

## Live AI Smoke Test

After Mock AI passes, switch to **Live AI** and ingest only `01-orion-launch-plan.txt`. Ask one hybrid question to confirm Gemini extraction, Gemini embeddings, Supabase vector search, Neo4j traversal, and synthesis work end to end. This keeps quota use small while testing the production connector path.
