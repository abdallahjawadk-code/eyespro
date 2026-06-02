export function buildOpenApiSpec(baseUrl?: string) {
  const base = baseUrl || 'http://127.0.0.1:3847';
  return {
    openapi: '3.0.3',
    info: {
      title: 'EyesPro REST API',
      version: '1.0.0',
      description:
        'Local API for Zapier, n8n, and external integrations. Auth: Authorization: Bearer epk_... — © Masar Network'
    },
    servers: [{ url: `${base}/api/v1` }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'http', scheme: 'bearer', description: 'API key starting with epk_' }
      }
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      '/health': {
        get: { summary: 'Health check', security: [], responses: { 200: { description: 'OK' } } }
      },
      '/openapi.json': {
        get: { summary: 'OpenAPI document', responses: { 200: { description: 'Spec JSON' } } }
      },
      '/articles': {
        get: {
          summary: 'List articles',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'page', in: 'query', schema: { type: 'integer' } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer' } }
          ],
          responses: { 200: { description: 'Article list' } }
        },
        post: {
          summary: 'Create article',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title'],
                  properties: {
                    title: { type: 'string' },
                    summary: { type: 'string' },
                    content: { type: 'string' },
                    link: { type: 'string' },
                    source: { type: 'string' },
                    category: { type: 'string' },
                    status: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: { 201: { description: 'Created' } }
        }
      },
      '/articles/{id}': {
        get: {
          summary: 'Get article',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }]
        },
        patch: { summary: 'Update article' },
        delete: { summary: 'Delete article' }
      },
      '/sources': {
        get: { summary: 'News sources', responses: { 200: { description: 'Source list' } } }
      },
      '/rss.xml': {
        get: {
          summary: 'RSS feed of published articles',
          security: [],
          responses: { 200: { description: 'application/rss+xml' } }
        }
      },
      '/hooks/article': {
        post: {
          summary: 'Webhook — create article',
          description: 'Requires scope webhook:receive',
          responses: { 201: { description: 'Created' } }
        }
      }
    }
  };
}
