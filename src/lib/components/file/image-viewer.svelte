<script lang="ts">
	import NoPreview from './no-preview.svelte';

	let { url, name }: { url: string; name: string } = $props();

	let failed = $state(false);
</script>

{#if failed}
	<NoPreview message="This image couldn’t be displayed. Try opening it externally." />
{:else}
	<div class="flex h-full items-center justify-center p-3">
		<img
			src={url}
			alt={name}
			class="max-h-full max-w-full rounded object-contain"
			onerror={() => (failed = true)}
		/>
	</div>
{/if}
