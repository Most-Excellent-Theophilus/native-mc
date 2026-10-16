// lib/pdf-thumbnail.ts
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { readFile } from '@tauri-apps/plugin-fs';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const THUMBNAIL_WIDTH = 400;

const EXT_COLORS: Record<string, string> = {
	// ─────────────────────────────────────────────
	// Images — purple / pink
	// ─────────────────────────────────────────────
	jpg: '#8b5cf6',
	jpeg: '#8b5cf6',
	png: '#8b5cf6',
	gif: '#ec4899',
	webp: '#8b5cf6',
	svg: '#f97316',
	bmp: '#8b5cf6',
	ico: '#8b5cf6',
	tif: '#8b5cf6',
	tiff: '#8b5cf6',
	avif: '#8b5cf6',
	heic: '#8b5cf6',
	heif: '#8b5cf6',

	// ─────────────────────────────────────────────
	// Documents
	// ─────────────────────────────────────────────
	pdf: '#e5484d',

	doc: '#2563eb',
	docx: '#2563eb',

	odt: '#2563eb',
	rtf: '#2563eb',

	// ─────────────────────────────────────────────
	// Spreadsheets — green
	// ─────────────────────────────────────────────
	xls: '#16a34a',
	xlsx: '#16a34a',
	ods: '#16a34a',
	csv: '#16a34a',

	// ─────────────────────────────────────────────
	// Presentations — orange
	// ─────────────────────────────────────────────
	ppt: '#ea580c',
	pptx: '#ea580c',
	odp: '#ea580c',

	// ─────────────────────────────────────────────
	// Text / Notes
	// ─────────────────────────────────────────────
	txt: '#64748b',
	md: '#64748b',

	// ─────────────────────────────────────────────
	// Audio — cyan
	// ─────────────────────────────────────────────
	mp3: '#06b6d4',
	wav: '#06b6d4',
	ogg: '#06b6d4',
	oga: '#06b6d4',
	m4a: '#06b6d4',
	aac: '#06b6d4',
	flac: '#06b6d4',
	weba: '#06b6d4',
	opus: '#06b6d4',

	// ─────────────────────────────────────────────
	// Video — red / rose
	// ─────────────────────────────────────────────
	mp4: '#f43f5e',
	m4v: '#f43f5e',
	mov: '#f43f5e',
	webm: '#f43f5e',
	avi: '#f43f5e',
	mkv: '#f43f5e',
	wmv: '#f43f5e',
	flv: '#f43f5e',
	mpeg: '#f43f5e',
	mpg: '#f43f5e',
	'3gp': '#f43f5e',

	// ─────────────────────────────────────────────
	// Archives — amber
	// ─────────────────────────────────────────────
	zip: '#f59e0b',
	rar: '#f59e0b',
	'7z': '#f59e0b',
	tar: '#f59e0b',
	gz: '#f59e0b',
	bz2: '#f59e0b',

	// ─────────────────────────────────────────────
	// Fonts — violet
	// ─────────────────────────────────────────────
	ttf: '#7c3aed',
	otf: '#7c3aed',
	woff: '#7c3aed',
	woff2: '#7c3aed',
	eot: '#7c3aed',

	// ─────────────────────────────────────────────
	// Code / structured text — blue/teal
	// ─────────────────────────────────────────────
	json: '#eab308',
	xml: '#f97316',
	yaml: '#ef4444',
	yml: '#ef4444',

	html: '#e34f26',
	htm: '#e34f26',

	css: '#1572b6',

	js: '#f7df1e',
	mjs: '#f7df1e',

	ts: '#3178c6',
	jsx: '#61dafb',
	tsx: '#61dafb',

	py: '#3776ab',
	sh: '#4ade80',
	sql: '#336791',

	// ─────────────────────────────────────────────
	// Miscellaneous
	// ─────────────────────────────────────────────
	bin: '#64748b',
	exe: '#64748b',
	dmg: '#64748b',

	apk: '#3ddc84',
	epub: '#8b5cf6',
	wasm: '#654ff0',
};
const DEFAULT_COLOR = '#64748b'; // slate-500, fallback for unknown extensions

/**
 * Builds a generic "file" icon SVG with the extension centered on it,
 * encoded as a data URL. Used for any file type we don't render a
 * real visual thumbnail for (docx, xlsx, pptx, unknown types, etc).
 */
export function generateFileIcon(extension: string): string {
	const ext = extension.toLowerCase().replace(/^\./, '');
	const color = EXT_COLORS[ext] ?? DEFAULT_COLOR;
	const label = ext.slice(0, 4).toUpperCase(); // keep long extensions from overflowing

	const width = THUMBNAIL_WIDTH;
	const height = Math.round(THUMBNAIL_WIDTH * (9 / 16)); // match the aspect-video slot it renders into

	// Simple dog-eared page shape, centered, with the extension label under the fold.
	const pageWidth = height * 0.62;
	const pageHeight = height * 0.82;
	const foldSize = pageWidth * 0.28;
	const pageX = (width - pageWidth) / 2;
	const pageY = (height - pageHeight) / 2;

	const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
	<rect width="${width}" height="${height}" fill="#f1f5f9"/>
	<path
		d="M ${pageX} ${pageY}
		   H ${pageX + pageWidth - foldSize}
		   L ${pageX + pageWidth} ${pageY + foldSize}
		   V ${pageY + pageHeight}
		   H ${pageX}
		   Z"
		fill="white"
		stroke="${color}"
		stroke-width="3"
	/>
	<path
		d="M ${pageX + pageWidth - foldSize} ${pageY}
		   L ${pageX + pageWidth} ${pageY + foldSize}
		   H ${pageX + pageWidth - foldSize}
		   Z"
		fill="${color}"
		fill-opacity="0.25"
		stroke="${color}"
		stroke-width="3"
		stroke-linejoin="round"
	/>
	<rect
		x="${pageX - 4}"
		y="${pageY + pageHeight * 0.62}"
		width="${pageWidth + 8}"
		height="${pageHeight * 0.24}"
		rx="4"
		fill="${color}"
	/>
	<text
		x="${pageX + (pageWidth + 8) / 2 - 4}"
		y="${pageY + pageHeight * 0.62 + (pageHeight * 0.24) / 2}"
		font-family="ui-sans-serif, system-ui, sans-serif"
		font-size="${Math.max(14, pageWidth * 0.16)}"
		font-weight="700"
		fill="white"
		text-anchor="middle"
		dominant-baseline="central"
	>${label}</text>
</svg>`.trim();

	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
export async function generateThumbnail(path: string): Promise<string> {
	const ext = path.split('.').at(-1)?.toLowerCase() ?? '';

	if (['jpeg', 'jpg', 'png', 'webp'].includes(ext)) {
		const bytes = await readFile(path);
		const blob = new Blob([bytes], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` });
		return URL.createObjectURL(blob);
	}

	return generateFileIcon(ext);
}
export function generateFileIconOnly(extension: string): string {
//   export function generateFileIcon(extension: string): string {
  const ext = extension.toLowerCase().replace(/^\./, '');
  const color = EXT_COLORS[ext] ?? DEFAULT_COLOR;
  const label = ext.slice(0, 4).toUpperCase();

  const width = 180;
  const height = 225;

  const foldSize = 45;

  const svg = `
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${width}"
  height="${height}"
  viewBox="0 0 ${width} ${height}"
>
  <path
    d="
      M 2 2
      H ${width - foldSize}
      L ${width - 2} ${foldSize}
      V ${height - 2}
      H 2
      Z
    "
    fill="white"
    stroke="${color}"
    stroke-width="4"
  />

  <path
    d="
      M ${width - foldSize} 2
      L ${width - 2} ${foldSize}
      H ${width - foldSize}
      Z
    "
    fill="${color}"
    fill-opacity="0.25"
    stroke="${color}"
    stroke-width="4"
    stroke-linejoin="round"
  />

  <rect
    x="0"
    y="${height * 0.62}"
    width="${width}"
    height="${height * 0.24}"
    fill="${color}"
  />

  <text
    x="${width / 2}"
    y="${height * 0.62 + (height * 0.24) / 2}"
    font-family="ui-sans-serif, system-ui, sans-serif"
    font-size="45"
    font-weight="700"
    fill="white"
    text-anchor="middle"
    dominant-baseline="central"
  >${label}</text>
</svg>
`.trim();

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}