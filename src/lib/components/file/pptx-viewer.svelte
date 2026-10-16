<script lang="ts">
	import { init } from 'pptx-preview';
	import { Loader2 } from '@lucide/svelte';

	import NoPreview from './no-preview.svelte';
	import { MAX_OFFICE_BYTES, previewFetch } from './preview-utils';

	let { url, size }: { url: string; size: number } = $props();

	let container = $state<HTMLDivElement>();
	let status = $state<'loading' | 'ready' | 'error'>('loading');

	const tooLarge = $derived(size > MAX_OFFICE_BYTES);

	$effect(() => {
		if (!container || tooLarge) return;

		const target = container;
		const controller = new AbortController();
		let previewer: ReturnType<typeof init> | undefined;
		status = 'loading';
		target.replaceChildren();

		(async () => {
			try {
				const res = await previewFetch(url, controller.signal);
				const data = await res.arrayBuffer();
				if (controller.signal.aborted) return;

				// 16:9 slide sized to the dialog; the library adds prev/next controls.
				const width = Math.max(320, target.clientWidth - 24);
				previewer = init(target, { width, height: Math.round((width * 9) / 16), mode: 'slide' });
				await previewer.preview(data);
				if (!controller.signal.aborted) status = 'ready';
			} catch {
				if (!controller.signal.aborted) status = 'error';
			}
		})();

		return () => {
			controller.abort();
			previewer?.destroy();
			target.replaceChildren();
		};
	});
</script>

{#if tooLarge}
	<NoPreview message="This file is too large to preview. Open it externally." />
{:else}
	<div class="relative min-h-full">
		<!-- Always mounted so the effect above has a node to render into. -->
		<div bind:this={container} class="flex justify-center p-3"></div>

		{#if status === 'loading'}
			<div class="absolute inset-0 flex items-center justify-center">
				<Loader2 class="size-6 animate-spin text-muted-foreground" />
			</div>
		{:else if status === 'error'}
			<div class="absolute inset-0 bg-muted">
				<NoPreview message="Couldn’t render this presentation. Try opening it externally." />
			</div>
		{/if}
	</div>
{/if}
