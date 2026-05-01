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

export type UploadImageHandler = (file: File) => Promise<string>;

export type UnlayerEditorOptions = {
    id: string;
    displayMode?: UnlayerDisplayMode;
    scriptUrl?: string;
    state?: Partial<UnlayerState> | UnlayerDesign | null;
    unlayerOptions?: Record<string, unknown>;
    uploadImage?: UploadImageHandler;
    templateClient?: TemplateClient;
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

export class UnlayerEditor {
    private readonly scriptUrl: string;

    private readonly displayMode: UnlayerDisplayMode;

    private readonly unlayerOptions: Record<string, unknown>;

    private readonly templateClient: TemplateClient;

    private state: UnlayerState;

    private ready = false;

    private internalUpdate = false;

    private booting = true;

    public constructor(
        private readonly options: UnlayerEditorOptions,
    ) {
        this.scriptUrl = options.scriptUrl ?? defaultScriptUrl;
        this.displayMode = options.displayMode ?? 'email';
        this.unlayerOptions = options.unlayerOptions ?? {};
        this.templateClient = options.templateClient ?? new UnlayerStockTemplateClient();
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
            ...options,
        });
    }

    public async loadTemplate(slug: string): Promise<UnlayerState> {
        const template = await this.templateClient.load(slug);

        this.loadDesign(template.design);

        return this.getState();
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

export default UnlayerEditor;
