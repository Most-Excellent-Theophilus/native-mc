<script lang="ts">
	import { Loader2 } from '@lucide/svelte';

	import NoPreview from './no-preview.svelte';
	import { MAX_TEXT_BYTES, previewFetch } from './preview-utils';

	interface Props {
		url: string;
		size: number;
		json?: boolean;
	}

	let { url, size, json = false }: Props = $props();

	let text = $state('');
	let status = $state<'loading' | 'ready' | 'error'>('loading');

	const tooLarge = $derived(size > MAX_TEXT_BYTES);

	$effect(() => {
		if (tooLarge) return;

		const controller = new AbortController();
		status = 'loading';

		(async () => {
			try {
				const res = await previewFetch(url, controller.signal);
				const raw = await res.text();
				if (controller.signal.aborted) return;

				if (json) {
					try {
						text = JSON.stringify(JSON.parse(raw), null, 2);
					} catch {
						text = raw; // not valid JSON — show it as-is
					}
				} else {
					text = raw;
				}
				status = 'ready';
			} catch {
				if (!controller.signal.aborted) status = 'error';
			}
		})();

		return () => controller.abort();
	});
</script>

{#if tooLarge}
	<NoPreview message="This file is too large to preview. Open it externally." />
{:else if status === 'error'}
	<NoPreview message="Couldn’t load this file." />
{:else if status === 'loading'}
	<div class="flex h-full items-center justify-center">
		<Loader2 class="size-6 animate-spin text-muted-foreground" />
	</div>
{:else}
	<pre class="p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{text}</pre>
{/if}
