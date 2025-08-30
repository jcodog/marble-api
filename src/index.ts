import { fromHono } from "chanfana";
import { Hono } from "hono";
import { MarbleImage } from "./endpoints/marbleImage";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Setup OpenAPI registry
const openapi = fromHono(app, {
  schema: {
    info: {
      title: "JCoNet Marble Image Generation API",
      version: "0.0.1",
      description:
        "Create cool looking marble images in the colors you specify",
    },
  },
  docs_url: "/",
});

// Register OpenAPI endpoints
openapi.get("api/v1/marbleImage", MarbleImage);

// You may also register routes for non OpenAPI directly on Hono
// app.get('/test', (c) => c.text('Hono!'))

// Export the Hono app
export default app;
