# AI Trip Designer MCP Server

AI Trip Designer is a minimal TypeScript + Express server that exposes Model Context Protocol (MCP) tools for planning multi-day trips. It uses OpenTripMap (attractions) and Open-Meteo (weather) directly, falls back to curated mock data for providers without keys, and returns both JSON and responsive HTML snippets so ChatGPT Apps can render rich results inline.

> 📸 *Screenshot placeholder:* add a capture of the rendered itinerary HTML inside your ChatGPT app widget once you connect this server.

## Features
- MCP tools for `planTrip`, `searchFlights`, `searchStays`, `nearbyAttractions`, and `weather`
- Responsive HTML snippets (cards, tables, itinerary) returned alongside JSON
- In-memory TTL cache (6h default) to reduce rate limits
- Deterministic mock data path when API keys are missing so demos always work
- Ngrok tunnel script for quick ChatGPT App testing

## Quick Start
```bash
pnpm install         # or npm install
cp .env.example .env
pnpm dev             # starts the MCP server on http://localhost:3333

# Optional: share via ngrok once authenticated
pnpm tunnel          # exposes the server at https://*.ngrok.io
```

Server endpoints:
- `GET /health` – health & registered tools
- `POST /mcp/tools/:toolName` – invoke a tool directly
- `POST /mcp/call` – generic tool invocation `{ "tool": "planTrip", "arguments": { ... } }`

## Environment Variables
Copy `.env.example` and fill in any keys you have:

| Variable | Provider | Notes |
| --- | --- | --- |
| `PORT` | server | Defaults to 3333 |
| `AMADEUS_CLIENT_ID` / `AMADEUS_CLIENT_SECRET` | Flights | Optional – enables Amadeus flight offers; otherwise mock flights |
| `SKYSCANNER_API_KEY` | Flights | Reserved for future enhancement |
| `BOOKING_RAPIDAPI_KEY` | Stays | Optional – replace mock data when wired to RapidAPI |
| `OPENTRIPMAP_API_KEY` | Attractions | **Required** for live nearby attractions |
| `OPENAI_API_KEY` | ChatGPT Apps | Used when you deploy the MCP server alongside an App manifest |

Open-Meteo does not require an API key.

## Available MCP Tools

| Tool | Description | Returned HTML |
| --- | --- | --- |
| `planTrip` | Builds a complete multi-day itinerary, weather snapshot, cost ranges | Full itinerary cards & tables |
| `searchFlights` | Fetches (or mocks) flight options | Flight cards |
| `searchStays` | Lists 10 stay options (budget → premium) | Stay cards grid |
| `nearbyAttractions` | Pulls 8–12 attractions/food spots via OpenTripMap | Attraction cards |
| `weather` | Multi-day forecast via Open-Meteo | Compact weather table |

All responses include `{ json..., html, meta }` so the ChatGPT widget can render the HTML while the model consumes the JSON.

## Example Tool Calls

### Using curl
```bash
# Plan a four-day Chiang Mai trip (works without paid keys)
curl -s http://localhost:3333/mcp/tools/planTrip \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "Chiang Mai",
    "startDate": "2025-11-20",
    "days": 4,
    "budgetUSD": 600,
    "interests": ["food","nature","temples","night market"]
  }' | jq

# Fetch weather snapshot
curl -s http://localhost:3333/mcp/tools/weather \
  -H "Content-Type: application/json" \
  -d '{ "lat": 18.7883, "lon": 98.9853, "startDate": "2025-11-20", "days": 4 }' | jq
```

### From a ChatGPT App Widget
```ts
await window.openai.callTool('planTrip', {
  destination: 'Chiang Mai',
  startDate: '2025-11-20',
  days: 4,
  budgetUSD: 600,
  interests: ['food', 'nature', 'temples', 'night market']
});
```

The widget receives `result.json` for model reasoning plus `result.html` for inline rendering (drop it straight into your chat UI).

## Provider Notes
- **Flights (Amadeus, Skyscanner, Duffel)** – Amadeus sandbox is wired for future keys; without credentials, deterministic mock flights are returned with a note.
- **Stays** – Currently mocked Chiang Mai inventory until Booking.com’s RapidAPI or Amadeus Hotel supply credentials are added.
- **Attractions & Food** – OpenTripMap (`OPENTRIPMAP_API_KEY`) provides live data. Without a key, curated Chiang Mai highlights are used.
- **Weather** – Open-Meteo free API powers the forecast; cache reduces repeat hits.

## Development Tips
- Adjust cache TTL by editing `src/cache.ts`.
- Tool schemas live in `src/mcp.ts`; extend them to add validation or new parameters.
- HTML templates are mobile-first and embedded per response. Customize styles in the helpers inside `src/mcp.ts`.
- Use the `GET /mcp/tools` endpoint for a quick schema preview during development.

## Publishing to the ChatGPT App Store (future)
1. Create an App manifest that points to your MCP server’s URL (ngrok or production).
2. Provide icons (square + dark/light variants) and a compelling description.
3. Decide on pricing (free tier recommended) and list any required API keys.
4. Package screenshots (see placeholder above) to showcase the itinerary cards inside the chat widget.
5. Submit once the App Store tooling is available, following OpenAI’s MCP server review guidelines.

## Project Structure
```
ai-trip-designer/
├─ src/
│  ├─ server.ts          # Express bootstrap
│  ├─ mcp.ts             # Tool registration, HTML renderers
│  ├─ cache.ts           # In-memory TTL cache
│  ├─ providers/         # Flights, stays, places, weather connectors
│  └─ types.ts           # Shared TypeScript types
├─ package.json          # Scripts: dev, start, typecheck, tunnel
├─ tsconfig.json
├─ .env.example
└─ README.md
```

---

Happy travels! Plug the server into your ChatGPT App, run `pnpm dev`, and the `planTrip` tool will generate a 4-day Chiang Mai itinerary (flights mocked, attractions/weather live) right out of the box.
