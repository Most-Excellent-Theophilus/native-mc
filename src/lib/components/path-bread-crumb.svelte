<!-- src/lib/components/path-breadcrumb.svelte -->
<!-- Header breadcrumb: bucket > folder > ... > file, from /preview?path=... -->
<script lang="ts">
	import { page } from '$app/state';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { settings } from '$lib/store/settings.svelte';

	let { fallback = 'Home' }: { fallback?: string } = $props();

	const onPreview = $derived(page.url.pathname.startsWith('/preview'));

	const path = $derived.by(() => {
		if (!onPreview) return '';
		const p = page.url.searchParams.get('path');
		return p ?? new URLSearchParams(window.location.search).get('path') ?? '';
	});

	const href = (p: string) => `/preview?path=${encodeURIComponent(p)}`;

	const crumbs = $derived.by(() => {
		const parts = path.split('/').filter(Boolean);
		const isFolder = path === '' || path.endsWith('/');
		const items = [{ label: settings.data.backupBucket || 'Files', path: '' }];
		parts.forEach((name, i) => {
			const last = i === parts.length - 1;
			items.push({ label: name, path: parts.slice(0, i + 1).join('/') + (last && !isFolder ? '' : '/') });
		});
		return items;
	});
</script>

<Breadcrumb.Root>
	<Breadcrumb.List>
		{#if !onPreview}
			<Breadcrumb.Item>
				<Breadcrumb.Page>{fallback}</Breadcrumb.Page>
			</Breadcrumb.Item>
		{:else}
			{#each crumbs as c, i (c.path)}
				{@const last = i === crumbs.length - 1}
				<!-- On small screens keep only the last two items -->
				<Breadcrumb.Item class={i < crumbs.length - 2 ? 'hidden md:block' : ''}>
					{#if last}
						<Breadcrumb.Page class="block max-w-48 truncate md:max-w-96">{c.label}</Breadcrumb.Page>
					{:else}
						<Breadcrumb.Link href={href(c.path)} class="block max-w-32 truncate md:max-w-48">
							{c.label}
						</Breadcrumb.Link>
					{/if}
				</Breadcrumb.Item>
				{#if !last}
					<Breadcrumb.Separator class={i < crumbs.length - 2 ? 'hidden md:block' : ''} />
				{/if}
			{/each}
		{/if}
	</Breadcrumb.List>
</Breadcrumb.Root>