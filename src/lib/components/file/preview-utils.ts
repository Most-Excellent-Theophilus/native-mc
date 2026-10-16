export type PreviewKind =
	| 'image'
	| 'pdf'
	| 'video'
	| 'audio'
	| 'text'
	| 'json'
	| 'csv'
	| 'docx'
	| 'xlsx'
	| 'pptx'
	| 'font'
	| 'none';

// Keyed by extension because contentType alone is unreliable here — e.g. `.ts`
// is registered as video/mp2t, which would send TypeScript files to <video>.
const KIND_BY_EXT = new Map<string, PreviewKind>(
	Object.entries({
		// Only formats the webview can decode. heic/heif/tif/tiff are left out on
		// purpose: WebKitGTK can't render them, so they fall through to "none".
		jpg: 'image',
		jpeg: 'image',
		png: 'image',
		gif: 'image',
		webp: 'image',
		svg: 'image',
		bmp: 'image',
		ico: 'image',
		avif: 'image',

		pdf: 'pdf',

		// Playback depends on the codecs installed on the machine; the viewer
		// falls back to "open externally" if the webview refuses to play it.
		mp4: 'video',
		m4v: 'video',
		mov: 'video',
		webm: 'video',
		ogv: 'video',
		mkv: 'video',
		avi: 'video',
		wmv: 'video',
		flv: 'video',
		mpeg: 'video',
		mpg: 'video',
		'3gp': 'video',

		mp3: 'audio',
		wav: 'audio',
		ogg: 'audio',
		oga: 'audio',
		m4a: 'audio',
		aac: 'audio',
		flac: 'audio',
		weba: 'audio',
		opus: 'audio',

		// Shown as source, never rendered — html/svg-as-text can't run scripts.
		txt: 'text',
		md: 'text',
		log: 'text',
		xml: 'text',
		yaml: 'text',
		yml: 'text',
		html: 'text',
		htm: 'text',
		css: 'text',
		js: 'text',
		mjs: 'text',
		ts: 'text',
		jsx: 'text',
		tsx: 'text',
		py: 'text',
		sh: 'text',
		sql: 'text',
		json: 'json',
		csv: 'csv',

		docx: 'docx',
		xlsx: 'xlsx',
		pptx: 'pptx',

		ttf: 'font',
		otf: 'font',
		woff: 'font',
		woff2: 'font'
	}) as [string, PreviewKind][]
);

const SAFE_IMAGE_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/svg+xml',
	'image/bmp',
	'image/avif'
]);

const LEGACY_OFFICE = new Set(['doc', 'xls', 'ppt', 'odt', 'ods', 'odp', 'rtf']);
const ARCHIVES = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2']);
const UNSUPPORTED_IMAGES = new Set(['heic', 'heif', 'tif', 'tiff']);

function extensionOf(path: string): string {
	const base = path.split('/').pop() ?? '';
	const dot = base.lastIndexOf('.');
	return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function kindFromContentType(contentType: string): PreviewKind {
	if (contentType === 'application/pdf') return 'pdf';
	if (contentType === 'application/json') return 'json';
	if (contentType === 'application/xml') return 'text';
	if (SAFE_IMAGE_TYPES.has(contentType)) return 'image';
	if (contentType.startsWith('video/')) return 'video';
	if (contentType.startsWith('audio/')) return 'audio';
	if (contentType.startsWith('text/')) return 'text';
	return 'none';
}

function noPreviewReason(ext: string): string {
	if (LEGACY_OFFICE.has(ext)) {
		return 'Legacy Office formats can\u2019t be previewed. Convert to .docx, .xlsx or .pptx, or open it externally.';
	}
	if (ARCHIVES.has(ext)) {
		return 'Archives can\u2019t be previewed. Open it externally to extract the contents.';
	}
	if (UNSUPPORTED_IMAGES.has(ext)) {
		return 'This image format isn\u2019t supported by the viewer. Open it externally.';
	}
	return 'No preview available for this file type.';
}

/**
 * Decides which viewer a file gets. The extension comes from `key` first — it's
 * written at upload time and can't be edited — then from the display `name`,
 * then we fall back to contentType.
 */
export function resolvePreview(file: { key: string; name: string; contentType: string }): {
	kind: PreviewKind;
	reason: string;
} {
	const ext = extensionOf(file.key) || extensionOf(file.name);
	const kind = KIND_BY_EXT.get(ext) ?? kindFromContentType(file.contentType);
	return { kind, reason: kind === 'none' ? noPreviewReason(ext) : '' };
}

export const MAX_TEXT_BYTES = 1024 * 1024; // 1 MB — text is dumped into the DOM
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_OFFICE_BYTES = 25 * 1024 * 1024;

/**
 * Every viewer that needs the file's bytes goes through here, so there is one
 * place to change. This is a cross-origin request from the webview, so the
 * bucket needs a CORS rule for your Tauri origin. To sidestep CORS entirely,
 * swap `fetch` for the one exported by `@tauri-apps/plugin-http`.
 */
export async function previewFetch(url: string, signal?: AbortSignal): Promise<Response> {
	const res = await fetch(url, { signal });
	if (!res.ok) throw new Error(`Failed to load file (${res.status})`);
	return res;
}

/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF. Stops after `maxRows`. */
export function parseCsv(text: string, maxRows: number): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;

	for (let i = 0; i < text.length && rows.length < maxRows; i++) {
		const c = text[i];

		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += c;
			}
		} else if (c === '"') {
			inQuotes = true;
		} else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else {
			field += c;
		}
	}

	// last line without a trailing newline
	if (rows.length < maxRows && (field !== '' || row.length > 0)) {
		row.push(field);
		rows.push(row);
	}

	return rows;
}
