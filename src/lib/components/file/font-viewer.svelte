<script lang="ts">
	import { Loader2 } from '@lucide/svelte';

	import NoPreview from './no-preview.svelte';
	import { previewFetch } from './preview-utils';

	let { url }: { url: string } = $props();

	// Unique per instance so two previews never fight over the same family name.
	const family = `preview-${crypto.randomUUID()}`;
	let status = $state<'loading' | 'ready' | 'error'>('loading');

	$effect(() => {
		const controller = new AbortController();
		let face: FontFace | undefined;
		status = 'loading';

		(async () => {
			try {
				const res = await previewFetch(url, controller.signal);
				face = new FontFace(family, await res.arrayBuffer());
				await face.load();
				if (controller.signal.aborted) return;
				document.fonts.add(face);
				status = 'ready';
			} catch {
				if (!controller.signal.aborted) status = 'error';
			}
		})();

		return () => {
			controller.abort();
			if (face) document.fonts.delete(face);
		};
	});
</script>

{#if status === 'error'}
	<NoPreview message="Couldn’t load this font." />
{:else if status === 'loading'}
	<div class="flex h-full items-center justify-center">
		<Loader2 class="size-6 animate-spin text-muted-foreground" />
	</div>
{:else}
	<div class="space-y-6 p-8" style:font-family={`"${family}", sans-serif`}>
		<p class="text-6xl leading-tight">Aa Bb Cc</p>
		<p class="text-3xl leading-snug">The quick brown fox jumps over the lazy dog</p>
		<p class="text-lg leading-relaxed">
			ABCDEFGHIJKLMNOPQRSTUVWXYZ<br />
			abcdefghijklmnopqrstuvwxyz<br />
			0123456789 !@#$%&amp;*()
		</p>
		<p class="text-sm">The quick brown fox jumps over the lazy dog</p>
	</div>
{/if}
