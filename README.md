# Unofficial Unlayer TypeScript SDK

Framework-free TypeScript wrapper for the Unlayer editor.

## Development

Build the package:

```bash
npm run build
```

Serve the local examples:

```bash
npm run examples:serve
```

Then open one of these pages in the browser:

```txt
http://127.0.0.1:4173/examples/basic.html
http://127.0.0.1:4173/examples/http-template-client.html
```

Do not open the example files with `file://`. Browser module imports from the local filesystem are blocked and the examples are designed to run over HTTP.

## Getting Started

```bash
npm install @community-sdks/unlayer-ts
```

## Usage

```ts
import UnlayerEditor, { HttpTemplateClient } from '@community-sdks/unlayer-ts'

const templateClient = new HttpTemplateClient({
    searchUrl: '/templates',
    loadUrl: '/templates/:slug',
})

const editor = new UnlayerEditor({
    id: 'editor',
    displayMode: 'email',
    templateClient,
    state: {
        html: '',
        design: {},
    },
    uploadImage: async file => {
        const data = new FormData()
        data.append('file', file)

        const response = await fetch('/your-upload-endpoint', {
            method: 'POST',
            body: data,
        })

        const body = await response.json()

        return body.url
    },
    onChange: state => {
        console.log(state.html, state.design)
    },
})

await editor.mount()

const templates = await editor.searchTemplates({ search: 'welcome' })
await editor.loadTemplate(templates[0].slug)
```

## Examples

`examples/basic.html` mounts the editor with a local sample design and lets you export the current state.

`examples/http-template-client.html` shows how to wire `HttpTemplateClient` to backend template proxy routes such as `/unlayer-livewire/templates` and `/unlayer-livewire/templates/:slug`.

Stock template search and filtering is built in:

```ts
const templates = await editor.searchTemplates({
    search: 'newsletter',
    type: 'email',
    premium: false,
    limit: 20,
    offset: 0,
    collection: '',
    sort: 'recent',
})
```

## Stock Templates And CORS

Unlayer's public stock template search endpoint does not allow browser CORS requests. That means browser code cannot call `https://unlayer.com/templates/search` directly with `fetch`, Axios, or `XMLHttpRequest`.

For browser apps, create a backend endpoint in your own app and use `HttpTemplateClient`:

```ts
import UnlayerEditor, { HttpTemplateClient } from '@community-sdks/unlayer-ts'

const editor = new UnlayerEditor({
    id: 'editor',
    templateClient: new HttpTemplateClient({
        searchUrl: '/templates',
        loadUrl: '/templates/:slug',
    }),
})
```

Your backend should expose:

```txt
GET /templates
GET /templates/{slug}
```

Relative URLs call the same domain as the page. For example, `/templates` becomes `https://your-app.test/templates`.

If your template backend is on another domain, use full URLs:

```ts
templateClient: new HttpTemplateClient({
    searchUrl: 'https://api.example.com/templates',
    loadUrl: 'https://api.example.com/templates/:slug',
})
```

When using full URLs on another domain, that backend must allow CORS for your frontend domain.

The browser calls your backend, and your backend calls Unlayer. If you are using this SDK outside a browser, you may use `UnlayerStockTemplateClient` directly.

## Upstream Unlayer Template API

Your backend search endpoint should call Unlayer like this:

```txt
POST https://unlayer.com/templates/search
Content-Type: application/json
```

The SDK search options map to Unlayer's request body:

```json
{
    "page": 1,
    "perPage": 20,
    "filter": {
        "premium": "",
        "collection": "",
        "name": "newsletter",
        "sortBy": "recent",
        "type": "email"
    }
}
```

Mapping:

```txt
search     -> filter.name
type       -> filter.type
premium    -> filter.premium, "true" when true, "" when false
limit      -> perPage
offset     -> page, calculated as floor(offset / limit) + 1
collection -> filter.collection
sort       -> filter.sortBy
```

Template thumbnails use:

```txt
GET https://api.unlayer.com/v2/stock-templates/{slug}/thumbnail?width=500
```

Template loading uses Unlayer Studio GraphQL:

```txt
POST https://studio.unlayer.com/api/v1/graphql
```

With this query:

```graphql
query StockTemplateLoad($slug: String!) {
    StockTemplate(slug: $slug) {
        StockTemplatePages {
            design
        }
    }
}
```
