<script lang="ts">
	import { FileIcon } from '@lucide/svelte';

	let {
		message = 'No preview available for this file type.',
		detail
	}: { message?: string; detail?: string } = $props();
</script>

<div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
	<FileIcon class="size-10 text-muted-foreground" />
	<p class="max-w-sm text-sm text-muted-foreground">{message}</p>
	{#if detail}
		<p class="max-w-sm font-mono text-xs break-words text-muted-foreground/70">{detail}</p>
	{/if}
</div>
