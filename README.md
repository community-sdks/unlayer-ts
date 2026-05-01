# Unofficial Unlayer TypeScript SDK

Framework-free TypeScript wrapper for the Unlayer editor.

## Getting Started

```bash
npm install @community-sdks/unlayer-ts
```

## Usage

```ts
import UnlayerEditor from '@community-sdks/unlayer-ts'

const editor = new UnlayerEditor({
    id: 'editor',
    displayMode: 'email',
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
