<!-- src/lib/components/file-grid.svelte -->
<!-- <FileGrid entries={entries} />     show entries you already loaded -->
<!-- <FileGrid path="Screenshots/" />   or let it list the folder itself -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import Folder from '@lucide/svelte/icons/folder';
	import { listDir, type Entry } from '$lib/bucketFiles';
	
	import { settings } from '$lib/store/settings.svelte';
  import { generateFileIcon, generateFileIconOnly } from '$lib/hooks/image-uploader';

	let { entries: given, path = '' }: { entries?: Entry[]; path?: string } = $props();

	let loaded = $state<Entry[]>([]);
	let loading = $state(false);
	let error = $state('');
	let token = 0; // ignore results of an older path

	const list = $derived(given ?? loaded);
	const mode = $derived(settings.data.viewMode); // toggled from the page header

	async function load(p: string) {
		const mine = ++token;
		loading = true;
		error = '';
		try {
			const result = await listDir(p);
			if (mine === token) loaded = result;
		} catch (e) {
			if (mine === token) error = e instanceof Error ? e.message : String(e);
		} finally {
			if (mine === token) loading = false;
		}
	}

	$effect(() => {
		if (given === undefined) void load(path);
	});

	const ext = (name: string) => (name.includes('.') ? (name.split('.').pop() ?? '') : '');
	const open = (p: string) => goto(`/preview?path=${encodeURIComponent(p)}`);

	function formatBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		const units = ['KB', 'MB', 'GB', 'TB'];
		let v = n / 1024;
		let i = 0;
		while (v >= 1024 && i < units.length - 1) {
			v /= 1024;
			i++;
		}
		return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
	}
</script>

{#if loading}
	<p class="text-sm text-muted-foreground">Reading the bucket…</p>
{:else if error}
	<p class="text-sm text-destructive">{error}</p>
{:else if list.length === 0}
	<p class="text-sm text-muted-foreground">Nothing here yet.</p>
{:else if mode === 'list'}
	<ul class="divide-y rounded-md border bg-background overflow-y-auto h-[calc(100dvh-100px)] ">
		{#each list as e (e.path)}
			<li>
				<button
					type="button"
					title={e.path}
					on:click={() => open(e.path)}
					class="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
				>
					{#if e.dir}
						<Folder class="size-8 shrink-0 fill-primary/10 text-primary" strokeWidth={1.25} />
					{:else}
						<img src={generateFileIconOnly(ext(e.name))} alt="" class="h-8 w-6 shrink-0" />
					{/if}
					<span class="min-w-0 flex-1 break-all">{e.name}</span>
					<span class="hidden w-16 shrink-0 text-xs text-muted-foreground uppercase sm:block">
						{e.dir ? 'Folder' : ext(e.name) || 'File'}
					</span>
					<span class="w-20 shrink-0 text-right text-xs text-muted-foreground">
						{e.dir ? '' : formatBytes(e.size)}
					</span>
				</button>
			</li>
		{/each}
		<br><br><br><br><br><br><br>
	</ul>
{:else}
<div class="h-[calc(100dvh-100px)] overflow-y-auto"><div class="grid min-w-0 grid-cols-2 gap-3 p-1 sm:grid-cols-3 md:grid-cols-4  pb-20">
		{#each list as e (e.path)}
			<button
				type="button"
				title={e.path}
				on:click={() => open(e.path)}
				class="group relative aspect-square w-full min-w-0 overflow-hidden rounded-lg border bg-card text-left text-card-foreground shadow-sm transition-colors hover:border-primary/50"
			>
				<!-- Preview -->
				{#if e.dir}
					<div class="absolute inset-0 flex items-center justify-center bg-muted/40">
						<Folder
							class="size-1/2 fill-primary/10 text-primary transition-transform duration-300 group-hover:scale-105"
							strokeWidth={1.25}
						/>
					</div>
				{:else}
					<img
						src={generateFileIcon(ext(e.name))}
						alt={e.name}
						loading="lazy"
						class="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105"
					/>
				{/if}

				<!-- Overlay -->
				<div
					class="absolute inset-0 bg-gradient-to-t from-background/90 via-background/10 to-transparent"
				></div>

				<!-- Type -->
				<div
					class="absolute top-2 left-2 z-10 rounded-md border border-border/50 bg-background/80 px-2 py-1 text-[9px] font-medium tracking-wide text-foreground uppercase shadow-sm backdrop-blur-sm"
				>
					{e.dir ? 'Folder' : ext(e.name) || 'File'}
				</div>

				<!-- Name and size -->
				<div class="absolute inset-x-0 bottom-0 z-10 p-3">
					<p class="truncate text-xs font-medium text-foreground">{e.name}</p>
					<p class="mt-1 text-[10px] text-muted-foreground">{e.dir ? '' : formatBytes(e.size)}</p>
				</div>
			</button>
		{/each}
	</div></div>
	
{/if}