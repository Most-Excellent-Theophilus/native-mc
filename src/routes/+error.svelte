<script lang="ts">
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';

	import { ChevronLeft, Home, TriangleAlert, FileQuestion } from '@lucide/svelte';

	import { Button } from '$lib/components/ui/button/index.js';

	const status = $derived(page.status);
	const notFound = $derived(status === 404);

	const title = $derived(notFound ? 'Page not found' : 'Something went wrong');
	const description = $derived(
		notFound
			? "The page you're looking for doesn't exist or was moved."
			: (page.error?.message ?? 'An unexpected error occurred.')
	);
</script>

<svelte:head>
	<title>{status} · {title}</title>
</svelte:head>

<div class="flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
	<div class="flex size-16 items-center justify-center rounded-full bg-muted">
		{#if notFound}
			<FileQuestion class="size-8 text-muted-foreground" />
		{:else}
			<TriangleAlert class="size-8 text-destructive" />
		{/if}
	</div>

	<div class="space-y-2">
		<p class="text-sm font-medium text-muted-foreground">{status}</p>
		<h1 class="text-3xl font-bold tracking-tight">{title}</h1>
		<p class="max-w-md text-muted-foreground">{description}</p>
	</div>

	<div class="flex flex-wrap items-center justify-center gap-2">
		<Button variant="outline" onclick={() => history.back()}>
			<ChevronLeft class="size-4" />
			Go back
		</Button>
		<Button onclick={() => goto('/')}>
			<Home class="size-4" />
			Home
		</Button>
		{#if !notFound}
			<Button variant="secondary" onclick={() => invalidateAll()}>Try again</Button>
		{/if}
	</div>
</div>
