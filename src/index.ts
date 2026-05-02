const defaultScriptUrl = 'https://editor.unlayer.com/embed.js?2';

type UnlayerDisplayMode = 'email' | 'web' | string;

export type UnlayerDesign = Record<string, unknown>;

export type UnlayerState = {
    html: string;
    design: UnlayerDesign;
};

export type StockTemplate = {
    slug: string;
    name: string;
    thumbnail?: string | null;
    rating?: number | string | null;
    premium?: boolean;
    [key: string]: unknown;
};

export type TemplateSearchOptions = {
    search?: string;
    type?: string;
    premium?: boolean;
    limit?: number;
    offset?: number;
    collection?: string;
    sort?: string;
};

type UnlayerTemplateApiResponse = {
    data?: Array<Record<string, unknown>>;
};

type UnlayerTemplateDesignResponse = {
    data?: {
        StockTemplate?: {
            StockTemplatePages?: Array<{
                design?: UnlayerDesign;
            }>;
        };
    };
};

export type TemplateLoadResult = {
    slug?: string;
    design: UnlayerDesign;
};

export type TemplateClient = {
    search(options: TemplateSearchOptions): Promise<StockTemplate[]>;
    load(slug: string): Promise<TemplateLoadResult>;
};

export type HttpTemplateClientOptions = {
    searchUrl: string;
    loadUrl: string;
};

export type UploadImageHandler = (file: File) => Promise<string>;

export type TemplatePickerOptions = {
    enabled?: boolean;
    showTrigger?: boolean;
    label?: string;
    triggerLabel?: string;
    title?: string;
    placeholder?: string;
    emptyText?: string;
};

export type UnlayerEditorOptions = {
    id: string;
    displayMode?: UnlayerDisplayMode;
    scriptUrl?: string;
    state?: Partial<UnlayerState> | UnlayerDesign | null;
    unlayerOptions?: Record<string, unknown>;
    uploadImage?: UploadImageHandler;
    templateClient?: TemplateClient;
    templateSearch?: TemplateSearchOptions;
    templatePicker?: TemplatePickerOptions;
    onReady?: (editor: UnlayerEditor) => void;
    onChange?: (state: UnlayerState) => void;
    onError?: (error: unknown) => void;
};

type UnlayerExportResult = {
    html?: string;
    design?: UnlayerDesign;
};

type UnlayerGlobal = {
    init(options: Record<string, unknown>): void;
    loadDesign(design: UnlayerDesign): void;
    exportHtml(callback: (data: UnlayerExportResult) => void): void;
    addEventListener(event: string, callback: () => void): void;
    registerCallback(name: string, callback: (file: { attachments: File[] }, done: (result: { progress: number; url: string }) => void) => void): void;
};

declare global {
    interface Window {
        unlayer?: UnlayerGlobal;
    }
}

let scriptPromise: Promise<void> | null = null;

export class UnlayerStockTemplateClient implements TemplateClient {
    public constructor(
        private readonly searchUrl: string = 'https://unlayer.com/templates/search',
        private readonly loadUrl: string = 'https://studio.unlayer.com/api/v1/graphql',
    ) {}

    public async search(options: TemplateSearchOptions = {}): Promise<StockTemplate[]> {
        const limit = options.limit ?? 20;
        const offset = options.offset ?? 0;
        const page = Math.floor(offset / limit) + 1;

        const response = await fetch(this.searchUrl, {
            method: 'POST',
            headers: {
                Accept: '*/*',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                page,
                perPage: limit,
                filter: {
                    premium: options.premium ? 'true' : '',
                    collection: options.collection ?? '',
                    name: options.search ?? '',
                    sortBy: options.sort ?? 'recent',
                    type: options.type ?? 'email',
                },
            }),
        });

        if (! response.ok) {
            throw new Error('Unable to search Unlayer templates.');
        }

        const body = await response.json() as UnlayerTemplateApiResponse;

        return (body.data ?? [])
            .map((template): StockTemplate | null => {
                const slug = typeof template.slug === 'string' ? template.slug : null;

                if (! slug) {
                    return null;
                }

                return {
                    ...template,
                    slug,
                    name: typeof template.name === 'string' ? template.name : 'Untitled template',
                    rating: typeof template.rating === 'number' || typeof template.rating === 'string' ? template.rating : null,
                    premium: Boolean(template.premium),
                    thumbnail: `https://api.unlayer.com/v2/stock-templates/${slug}/thumbnail?width=500`,
                };
            })
            .filter((template): template is StockTemplate => template !== null);
    }

    public async load(slug: string): Promise<TemplateLoadResult> {
        const response = await fetch(this.loadUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: `
                    query StockTemplateLoad($slug: String!) {
                        StockTemplate(slug: $slug) {
                            StockTemplatePages {
                                design
                            }
                        }
                    }
                `,
                variables: {
                    slug,
                },
            }),
        });

        if (! response.ok) {
            throw new Error(`Unable to load Unlayer template [${slug}].`);
        }

        const body = await response.json() as UnlayerTemplateDesignResponse;
        const design = body.data?.StockTemplate?.StockTemplatePages?.[0]?.design;

        if (! design) {
            throw new Error(`Unlayer template [${slug}] did not return a design.`);
        }

        return {
            slug,
            design,
        };
    }
}

export class HttpTemplateClient implements TemplateClient {
    private readonly searchUrl: string;

    private readonly loadUrl: string;

    public constructor(
        options: HttpTemplateClientOptions,
    );

    public constructor(
        searchUrl: string,
        loadUrl?: string,
    );

    public constructor(
        searchUrlOrOptions: string | HttpTemplateClientOptions,
        loadUrl?: string,
    ) {
        this.searchUrl = typeof searchUrlOrOptions === 'string'
            ? searchUrlOrOptions
            : searchUrlOrOptions.searchUrl;

        this.loadUrl = typeof searchUrlOrOptions === 'string'
            ? (loadUrl ?? searchUrlOrOptions)
            : searchUrlOrOptions.loadUrl;
    }

    public async search(options: TemplateSearchOptions = {}): Promise<StockTemplate[]> {
        const url = new URL(this.searchUrl, window.location.origin);

        Object.entries(options).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') {
                url.searchParams.set(key, String(value));
            }
        });

        const response = await fetch(url, {
            headers: {
                Accept: 'application/json',
            },
        });

        if (! response.ok) {
            throw new Error('Unable to search templates.');
        }

        const body = await response.json() as { data?: StockTemplate[] };

        return body.data ?? [];
    }

    public async load(slug: string): Promise<TemplateLoadResult> {
        const response = await fetch(this.resolveLoadUrl(slug), {
            headers: {
                Accept: 'application/json',
            },
        });

        if (! response.ok) {
            throw new Error(`Unable to load template [${slug}].`);
        }

        const body = await response.json() as { data?: TemplateLoadResult };

        if (! body.data?.design) {
            throw new Error(`Template [${slug}] did not return a design.`);
        }

        return body.data;
    }

    private resolveLoadUrl(slug: string): string {
        if (this.loadUrl.includes(':slug')) {
            return this.loadUrl.replace(':slug', encodeURIComponent(slug));
        }

        return `${this.loadUrl.replace(/\/$/, '')}/${encodeURIComponent(slug)}`;
    }
}

export class UnlayerEditor {
    private readonly scriptUrl: string;

    private readonly displayMode: UnlayerDisplayMode;

    private readonly unlayerOptions: Record<string, unknown>;

    private readonly templateClient: TemplateClient;

    private readonly templateSearch: TemplateSearchOptions;

    private readonly templatePicker: Required<TemplatePickerOptions>;

    private state: UnlayerState;

    private ready = false;

    private internalUpdate = false;

    private booting = true;

    private templatePickerElements?: {
        panel: HTMLElement;
        searchInput: HTMLInputElement;
        grid: HTMLElement;
        status: HTMLElement;
        surface: HTMLElement;
        toolbar?: HTMLElement;
    };

    public constructor(
        private readonly options: UnlayerEditorOptions,
    ) {
        this.scriptUrl = options.scriptUrl ?? defaultScriptUrl;
        this.displayMode = options.displayMode ?? 'email';
        this.unlayerOptions = options.unlayerOptions ?? {};
        this.templateClient = options.templateClient ?? new UnlayerStockTemplateClient();
        this.templateSearch = options.templateSearch ?? {};
        this.templatePicker = {
            enabled: options.templatePicker?.enabled ?? Boolean(options.templateSearch),
            showTrigger: options.templatePicker?.showTrigger ?? true,
            label: options.templatePicker?.label ?? 'Template Editor',
            triggerLabel: options.templatePicker?.triggerLabel ?? 'Templates',
            title: options.templatePicker?.title ?? 'Templates',
            placeholder: options.templatePicker?.placeholder ?? 'Search templates',
            emptyText: options.templatePicker?.emptyText ?? 'No templates found.',
        };
        this.state = normalizeState(options.state);
    }

    public async mount(): Promise<void> {
        await loadUnlayerScript(this.scriptUrl);

        const unlayer = this.getUnlayer();

        unlayer.init({
            id: this.options.id,
            displayMode: this.displayMode,
            ...this.unlayerOptions,
        });

        this.registerImageUploadCallback();
        this.registerDesignUpdatedListener();
        this.mountTemplatePicker();

        this.ready = true;
        this.loadDesign(this.state.design, { exportAfterLoad: false });
        this.options.onReady?.(this);
    }

    public isReady(): boolean {
        return this.ready;
    }

    public getState(): UnlayerState {
        return clone(this.state);
    }

    public setState(state: Partial<UnlayerState> | UnlayerDesign): void {
        const nextState = normalizeState(state);

        this.state = nextState;

        if (this.ready && ! this.internalUpdate) {
            this.loadDesign(nextState.design);
        }

        this.internalUpdate = false;
    }

    public loadDesign(design: UnlayerDesign, options: { exportAfterLoad?: boolean } = {}): void {
        if (! this.ready || isEmptyDesign(design)) {
            return;
        }

        this.getUnlayer().loadDesign(clone(design));

        if (options.exportAfterLoad ?? true) {
            this.exportState();
        }
    }

    public async exportState(): Promise<UnlayerState> {
        const data = await new Promise<UnlayerExportResult>((resolve) => {
            this.getUnlayer().exportHtml(resolve);
        });

        this.internalUpdate = true;
        this.state = {
            html: data.html ?? '',
            design: clone(data.design ?? {}),
        };
        this.booting = false;
        this.options.onChange?.(this.getState());

        return this.getState();
    }

    public async searchTemplates(options: TemplateSearchOptions = {}): Promise<StockTemplate[]> {
        return this.templateClient.search({
            type: this.displayMode,
            ...this.templateSearch,
            ...options,
        });
    }

    public async loadTemplate(slug: string): Promise<UnlayerState> {
        const template = await this.templateClient.load(slug);

        this.loadDesign(template.design);

        return this.getState();
    }

    public async openTemplatePicker(): Promise<void> {
        if (! this.templatePickerElements) {
            return;
        }

        this.templatePickerElements.panel.hidden = false;
        await this.refreshTemplatePicker();
        this.templatePickerElements.searchInput.focus();
    }

    public closeTemplatePicker(): void {
        if (this.templatePickerElements) {
            this.templatePickerElements.panel.hidden = true;
        }
    }

    private registerImageUploadCallback(): void {
        if (! this.options.uploadImage) {
            return;
        }

        this.getUnlayer().registerCallback('image', (file, done) => {
            const attachment = file.attachments[0];

            this.options.uploadImage?.(attachment)
                .then((url) => done({ progress: 100, url }))
                .catch((error: unknown) => this.handleError(error));
        });
    }

    private registerDesignUpdatedListener(): void {
        this.getUnlayer().addEventListener('design:updated', () => {
            if (! this.booting) {
                this.internalUpdate = true;
            }

            this.exportState().catch((error: unknown) => this.handleError(error));
        });
    }

    private mountTemplatePicker(): void {
        if (! this.templatePicker.enabled) {
            return;
        }

        const container = document.getElementById(this.options.id);

        if (! container) {
            return;
        }

        container.style.position = container.style.position || 'relative';
        container.classList.add('unlayer-sdk-editor-surface');
        container.appendChild(this.createTemplatePickerPanel());

        const elements = this.templatePickerElements;

        if (! elements) {
            return;
        }

        elements.surface = container;

        if (this.templatePicker.showTrigger) {
            const toolbar = this.createTemplatePickerToolbar();
            elements.toolbar = toolbar;
            container.parentElement?.insertBefore(toolbar, container);
        }
    }

    private createTemplatePickerToolbar(): HTMLElement {
        const toolbar = document.createElement('div');
        toolbar.className = 'unlayer-sdk-template-toolbar';

        const label = document.createElement('span');
        label.className = 'unlayer-sdk-template-toolbar-label';
        label.textContent = this.templatePicker.label;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'unlayer-sdk-template-toolbar-button';
        button.textContent = this.templatePicker.triggerLabel;
        button.addEventListener('click', () => {
            this.openTemplatePicker().catch((error: unknown) => this.handleError(error));
        });

        toolbar.append(label, button);

        return toolbar;
    }

    private createTemplatePickerPanel(): HTMLElement {
        const panel = document.createElement('section');
        panel.className = 'unlayer-sdk-template-panel';
        panel.hidden = true;

        const header = document.createElement('div');
        header.className = 'unlayer-sdk-template-panel-header';

        const title = document.createElement('strong');
        title.textContent = this.templatePicker.title;

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'unlayer-sdk-template-close';
        close.setAttribute('aria-label', 'Close templates');
        close.textContent = '×';
        close.addEventListener('click', () => this.closeTemplatePicker());

        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.className = 'unlayer-sdk-template-search';
        searchInput.placeholder = this.templatePicker.placeholder;
        searchInput.value = this.templateSearch.search ?? '';
        searchInput.addEventListener('input', debounce(() => {
            this.refreshTemplatePicker(searchInput.value)
                .catch((error: unknown) => this.handleError(error));
        }, 300));

        const status = document.createElement('div');
        status.className = 'unlayer-sdk-template-status';

        const grid = document.createElement('div');
        grid.className = 'unlayer-sdk-template-grid';

        header.append(title, close);
        panel.append(stylesElement(), header, searchInput, status, grid);

        this.templatePickerElements = {
            panel,
            searchInput,
            grid,
            status,
            surface: panel,
        };

        return panel;
    }

    private async refreshTemplatePicker(search?: string): Promise<void> {
        if (! this.templatePickerElements) {
            return;
        }

        const { grid, status } = this.templatePickerElements;

        status.textContent = 'Loading templates...';
        grid.replaceChildren();

        const templates = await this.searchTemplates({
            search: search ?? this.templateSearch.search ?? '',
        });

        status.textContent = templates.length === 0 ? this.templatePicker.emptyText : '';

        grid.replaceChildren(
            ...templates.map((template) => this.createTemplateCard(template)),
        );
    }

    private createTemplateCard(template: StockTemplate): HTMLElement {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'unlayer-sdk-template-card';

        if (template.thumbnail) {
            const image = document.createElement('img');
            image.src = template.thumbnail;
            image.alt = '';
            image.loading = 'lazy';
            card.appendChild(image);
        }

        const name = document.createElement('span');
        name.textContent = template.name;
        card.appendChild(name);

        const loader = document.createElement('span');
        loader.className = 'unlayer-sdk-template-card-loader';
        loader.setAttribute('aria-hidden', 'true');
        loader.hidden = true;
        card.appendChild(loader);

        card.addEventListener('click', async () => {
            if (card.disabled) {
                return;
            }

            card.disabled = true;
            card.classList.add('unlayer-sdk-template-card-loading');
            loader.hidden = false;

            if (this.templatePickerElements) {
                this.templatePickerElements.status.textContent = 'Loading template...';
            }

            try {
                await this.loadTemplate(template.slug);
                this.closeTemplatePicker();
            } catch (error: unknown) {
                card.disabled = false;
                card.classList.remove('unlayer-sdk-template-card-loading');
                loader.hidden = true;
                this.handleError(error);
            }
        });

        return card;
    }

    private getUnlayer(): UnlayerGlobal {
        if (! window.unlayer) {
            throw new Error('Unlayer script is not loaded.');
        }

        return window.unlayer;
    }

    private handleError(error: unknown): void {
        if (this.options.onError) {
            this.options.onError(error);

            return;
        }

        throw error;
    }
}

export async function loadUnlayerScript(scriptUrl: string = defaultScriptUrl): Promise<void> {
    if (window.unlayer) {
        return;
    }

    if (scriptPromise) {
        return scriptPromise;
    }

    scriptPromise = new Promise((resolve, reject) => {
        const existingScript = Array.from(document.querySelectorAll('script'))
            .find((script) => script.src.includes(scriptUrl));

        if (existingScript) {
            existingScript.addEventListener('load', () => resolve(), { once: true });
            existingScript.addEventListener('error', reject, { once: true });

            return;
        }

        const script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        script.addEventListener('load', () => resolve(), { once: true });
        script.addEventListener('error', reject, { once: true });

        document.head.appendChild(script);
    });

    return scriptPromise;
}

function normalizeState(state: Partial<UnlayerState> | UnlayerDesign | null | undefined): UnlayerState {
    if (! state) {
        return {
            html: '',
            design: {},
        };
    }

    if ('design' in state || 'html' in state) {
        return {
            html: typeof state.html === 'string' ? state.html : '',
            design: clone((state.design ?? {}) as UnlayerDesign),
        };
    }

    return {
        html: '',
        design: clone(state),
    };
}

function isEmptyDesign(design: UnlayerDesign): boolean {
    return Object.keys(design).length === 0;
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function debounce(callback: () => void, wait: number): () => void {
    let timeout: number | undefined;

    return () => {
        window.clearTimeout(timeout);
        timeout = window.setTimeout(callback, wait);
    };
}

function escapeHtml(value: string): string {
    const element = document.createElement('span');
    element.textContent = value;

    return element.innerHTML;
}

function stylesElement(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
        .unlayer-sdk-template-toolbar {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
            align-items: center;
            gap: 12px;
            min-height: 48px;
            box-sizing: border-box;
            border: 1px solid #d1d5db;
            border-bottom: 0;
            background: #ffffff;
            padding: 8px 12px;
            color: #111827;
            font: 14px/1.4 Arial, sans-serif;
        }

        .unlayer-sdk-editor-surface {
            border: 1px solid #d1d5db;
            box-sizing: border-box;
        }

        .unlayer-sdk-template-toolbar-label {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-weight: 600;
        }

        .unlayer-sdk-template-toolbar-button {
            grid-column: 3;
            justify-self: end;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 34px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            background: #f9fafb;
            color: #111827;
            font: 600 13px/1.2 Arial, sans-serif;
            padding: 0 12px;
            cursor: pointer;
            box-sizing: border-box;
        }

        .unlayer-sdk-template-toolbar-button:hover {
            background: #ffffff;
            border-color: #9ca3af;
        }

        .unlayer-sdk-template-panel {
            position: absolute;
            inset: 0;
            z-index: 40;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
            background: #ffffff;
            color: #111827;
            border: 1px solid #d1d5db;
            font: 14px/1.4 Arial, sans-serif;
        }

        .unlayer-sdk-template-panel[hidden] {
            display: none;
        }

        .unlayer-sdk-template-panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-height: 56px;
            padding: 0 18px;
            border-bottom: 1px solid #e5e7eb;
        }

        .unlayer-sdk-template-close {
            width: 34px;
            height: 34px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            background: #ffffff;
            color: #111827;
            cursor: pointer;
        }

        .unlayer-sdk-template-search {
            display: block;
            width: calc(100% - 36px);
            margin: 16px 18px 8px;
            min-height: 40px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            padding: 0 12px;
            background: #ffffff;
            color: #111827;
            font: inherit;
            box-sizing: border-box;
            appearance: none;
            -webkit-appearance: none;
        }

        .unlayer-sdk-template-search::-webkit-search-decoration,
        .unlayer-sdk-template-search::-webkit-search-cancel-button,
        .unlayer-sdk-template-search::-webkit-search-results-button,
        .unlayer-sdk-template-search::-webkit-search-results-decoration {
            -webkit-appearance: none;
            appearance: none;
        }

        .unlayer-sdk-template-status {
            min-height: 22px;
            padding: 0 18px 8px;
            color: #6b7280;
            font-size: 13px;
        }

        .unlayer-sdk-template-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 16px;
            overflow: auto;
            padding: 0 18px 18px;
        }

        .unlayer-sdk-template-card {
            display: flex;
            flex-direction: column;
            gap: 10px;
            position: relative;
            min-height: 238px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            background: #ffffff;
            padding: 10px;
            text-align: left;
            cursor: pointer;
        }

        .unlayer-sdk-template-card:hover {
            border-color: #2563eb;
        }

        .unlayer-sdk-template-card:disabled {
            cursor: wait;
            opacity: 0.86;
        }

        .unlayer-sdk-template-card img {
            width: 100%;
            aspect-ratio: 16 / 11;
            object-fit: cover;
            background: #f3f4f6;
            border-radius: 4px;
        }

        .unlayer-sdk-template-card span {
            color: #111827;
            font-weight: 600;
            line-height: 1.35;
            overflow-wrap: anywhere;
        }

        .unlayer-sdk-template-card-loader {
            position: absolute;
            top: 14px;
            right: 14px;
            width: 20px;
            height: 20px;
            box-sizing: border-box;
            border: 2px solid #d1d5db;
            border-top-color: #2563eb;
            border-radius: 999px;
            background: transparent;
            animation: unlayer-sdk-template-spin 0.8s linear infinite;
        }

        .unlayer-sdk-template-card-loader[hidden] {
            display: none;
        }

        @keyframes unlayer-sdk-template-spin {
            to {
                transform: rotate(360deg);
            }
        }
    `;

    return style;
}

export default UnlayerEditor;
