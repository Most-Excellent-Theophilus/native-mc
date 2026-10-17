<script lang="ts">
	import { Music } from '@lucide/svelte';

	import NoPreview from './no-preview.svelte';

	interface Props {
		url: string;
		kind: 'video' | 'audio';
	}

	let { url, kind }: Props = $props();

	// MediaError.code values: 1 aborted, 2 network, 3 decode, 4 source not supported.
	const HINTS: Record<number, string> = {
		2: 'The file couldn\u2019t be downloaded (network error, or the storage URL was blocked).',
		3: 'The file downloaded but couldn\u2019t be decoded, usually because a codec is missing.',
		4: 'The format or codec isn\u2019t supported here (on Linux this is usually missing GStreamer plugins), or the URL was blocked.'
	};

	let detail = $state<string | null>(null);

	function onMediaError(e: Event) {
		const err = (e.currentTarget as HTMLMediaElement).error;
		// Log the origin only — the full URL carries a signature.
		console.error('[preview] media error', {
			code: err?.code,
			message: err?.message,
			origin: new URL(url).origin
		});
		const hint = (err && HINTS[err.code]) ?? 'Playback failed.';
		detail = `${hint} (code ${err?.code ?? '?'}${err?.message ? `: ${err.message}` : ''})`;
	}
</script>

{#if detail}
	<NoPreview
		message="This device can’t play this file here. Use “Open externally” instead."
		{detail}
	/>
{:else if kind === 'video'}
	<div class="flex h-full items-center justify-center bg-black">
		<video
			src={url}
			controls
			autoplay
			preload="metadata"
			class="max-h-full max-w-full"
			onerror={onMediaError}
		>
			<track kind="captions" />
		</video>
	</div>
{:else}
	<div class="flex h-full flex-col items-center justify-center gap-6 p-6">
		<div class="flex size-16 items-center justify-center rounded-full bg-muted">
			<Music class="size-8 text-muted-foreground" />
		</div>
		<audio  src={url} controls preload="metadata" class="w-full max-w-md" onerror={onMediaError}
			autoplay
		
		></audio>
	</div>
{/if}
