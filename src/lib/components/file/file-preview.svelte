<script lang="ts">
	import { Loader2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import DocxViewer from './docx-viewer.svelte';
	import FontViewer from './font-viewer.svelte';
	import ImageViewer from './image-viewer.svelte';
	import MediaViewer from './media-viewer.svelte';
	import NoPreview from './no-preview.svelte';
	import PdfViewer from './pdf-viewer.svelte';
	import PptxViewer from './pptx-viewer.svelte';
	import SheetViewer from './sheet-viewer.svelte';
	import TextViewer from './text-viewer.svelte';
	import { resolvePreview } from './preview-utils';

	export type PreviewFile = { key: string; name: string; contentType: string; size: number };

	interface Props {
		file: PreviewFile | null;
		url: string; // presigned link, '' until it is ready
		loading: boolean;
		error: string;
		onRetry: () => void;
	}

	let { file, url, loading, error, onRetry }: Props = $props();
	const preview = $derived(file ? resolvePreview(file) : null);
</script>

{#if !file || !preview}
	<!-- nothing selected -->
{:else if preview.kind === 'none'}
	<NoPreview message={preview.reason} />
{:else if error}
	<div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
		<p class="text-sm text-muted-foreground">Couldn't create a link for this file.</p>
		<p class="max-w-sm font-mono text-xs break-words text-muted-foreground/70">{error}</p>
		<Button variant="outline" size="sm" onclick={onRetry}>Retry</Button>
	</div>
{:else if loading || !url}
	<div class="flex h-full items-center justify-center">
		<Loader2 class="size-6 animate-spin text-muted-foreground" />
	</div>
{:else}
	{#key url}
		{#if preview.kind === 'image'}
			<ImageViewer {url} name={file.name} />
		{:else if preview.kind === 'pdf'}
			<PdfViewer {url} />
		{:else if preview.kind === 'video' || preview.kind === 'audio'}
			<MediaViewer {url} kind={preview.kind} />
		{:else if preview.kind === 'text'}
			<TextViewer {url} size={file.size} />
		{:else if preview.kind === 'json'}
			<TextViewer {url} size={file.size} json />
		{:else if preview.kind === 'csv'}
			<SheetViewer {url} size={file.size} format="csv" />
		{:else if preview.kind === 'xlsx'}
			<SheetViewer {url} size={file.size} format="xlsx" />
		{:else if preview.kind === 'docx'}
			<DocxViewer {url} size={file.size} />
		{:else if preview.kind === 'pptx'}
			<PptxViewer {url} size={file.size} />
		{:else if preview.kind === 'font'}
			<FontViewer {url} />
		{/if}
	{/key}
{/if}
