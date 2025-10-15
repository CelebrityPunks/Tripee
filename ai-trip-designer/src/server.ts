import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import { createTripMcpServer } from './mcp';
import { defaultCache } from './cache';

const PORT = Number(process.env.PORT ?? 3333);

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const tripServer = createTripMcpServer({ cache: defaultCache });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', tools: tripServer.listTools().map((tool) => tool.name) });
  });

  app.use('/mcp', tripServer.router);

  app.listen(PORT, () => {
    const tools = tripServer.listTools().map((tool) => tool.name).join(', ');
    console.log(`[ai-trip-designer] Listening on http://localhost:${PORT}`);
    console.log(`[ai-trip-designer] Registered tools: ${tools}`);
  });
}

bootstrap().catch((error) => {
  console.error('[ai-trip-designer] Failed to start server:', error);
  process.exit(1);
});
