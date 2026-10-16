<script lang="ts">
	import * as pdfjsLib from 'pdfjs-dist';
	import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
	import { Loader2 } from '@lucide/svelte';

	pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

	let { url }: { url: string } = $props();

	let container = $state<HTMLDivElement>();
	let status = $state<'loading' | 'ready' | 'error'>('loading');

	$effect(() => {
		if (!container) return;

		const target = container;
		const source = url;
		let cancelled = false;
		let task: pdfjsLib.PDFDocumentLoadingTask | undefined;

		status = 'loading';
		target.replaceChildren();

		(async () => {
			try {
				task = pdfjsLib.getDocument({ url: source });
				const pdf = await task.promise;

				const cssWidth = target.clientWidth || 800;
				const dpr = window.devicePixelRatio || 1;

				// Pages render one after another so page 1 shows up immediately
				// instead of waiting on the whole document.
				for (let n = 1; n <= pdf.numPages; n++) {
					if (cancelled) return;

					const page = await pdf.getPage(n);
					const base = page.getViewport({ scale: 1 });
					const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });

					const canvas = document.createElement('canvas');
					canvas.width = viewport.width;
					canvas.height = viewport.height;
					canvas.style.width = '100%';
					canvas.style.height = 'auto';
					canvas.className = 'mb-3 rounded bg-white shadow-sm';
					target.appendChild(canvas);

					await page.render({
						canvas,
						canvasContext: canvas.getContext('2d')!,
						viewport
					}).promise;

					if (n === 1) status = 'ready';
				}
			} catch {
				if (!cancelled) status = 'error';
			}
		})();

		return () => {
			cancelled = true;
			task?.destroy();
		};
	});
</script>

<div class="relative">
	<!-- Always mounted so the effect above has a node to render into. -->
	<div bind:this={container} class="p-3"></div>

	{#if status === 'loading'}
		<div class="absolute inset-0 flex items-center justify-center">
			<Loader2 class="size-6 animate-spin text-muted-foreground" />
		</div>
	{:else if status === 'error'}
		<div class="absolute inset-0 flex items-center justify-center p-6 text-center">
			<p class="text-sm text-muted-foreground">
				Couldn't render this PDF here. Use "Open externally" instead.
			</p>
		</div>
	{/if}
</div>
