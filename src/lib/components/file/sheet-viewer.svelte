<script lang="ts">
	import { Loader2 } from '@lucide/svelte';
	import readXlsxFile from 'read-excel-file/universal';

	import { cn } from '$lib/utils';

	import NoPreview from './no-preview.svelte';
	import { MAX_CSV_BYTES, MAX_OFFICE_BYTES, parseCsv, previewFetch } from './preview-utils';

	interface Props {
		url: string;
		size: number;
		format: 'csv' | 'xlsx';
	}

	let { url, size, format }: Props = $props();

	const MAX_ROWS = 500;

	type SheetView = { name: string; rows: string[][]; truncated: boolean };

	let sheets = $state<SheetView[]>([]);
	let active = $state(0);
	let status = $state<'loading' | 'ready' | 'error'>('loading');

	const tooLarge = $derived(size > (format === 'csv' ? MAX_CSV_BYTES : MAX_OFFICE_BYTES));

	function cellToString(cell: unknown): string {
		if (cell === null || cell === undefined) return '';
		if (cell instanceof Date) return cell.toLocaleDateString();
		return String(cell);
	}

	$effect(() => {
		if (tooLarge) return;

		const controller = new AbortController();
		status = 'loading';

		(async () => {
			try {
				const res = await previewFetch(url, controller.signal);

				let next: SheetView[];
				if (format === 'csv') {
					// ask for one extra row so we know whether we truncated
					const rows = parseCsv(await res.text(), MAX_ROWS + 1);
					next = [
						{ name: 'CSV', rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS }
					];
				} else {
					const parsed = await readXlsxFile(await res.arrayBuffer());
					next = parsed.map(({ sheet, data }) => ({
						name: sheet,
						rows: data.slice(0, MAX_ROWS).map((row) => row.map(cellToString)),
						truncated: data.length > MAX_ROWS
					}));
				}

				if (controller.signal.aborted) return;
				sheets = next;
				active = 0;
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
	<NoPreview message="Couldn’t read this file." />
{:else if status === 'loading'}
	<div class="flex h-full items-center justify-center">
		<Loader2 class="size-6 animate-spin text-muted-foreground" />
	</div>
{:else}
	{@const sheet = sheets[active]}
	{#if !sheet}
		<NoPreview message="This file is empty." />
	{:else}
		<div class="flex h-full flex-col">
			{#if sheets.length > 1}
				<div class="flex gap-1 overflow-x-auto border-b bg-background p-2">
					{#each sheets as s, i (i)}
						<button
							type="button"
							class={cn(
								'rounded-md px-3 py-1 text-sm whitespace-nowrap',
								i === active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
							)}
							onclick={() => (active = i)}
						>
							{s.name}
						</button>
					{/each}
				</div>
			{/if}

			<div class="min-h-0 flex-1 overflow-auto">
				{#if sheet.rows.length === 0}
					<NoPreview message="This sheet is empty." />
				{:else}
					<table class="w-max min-w-full border-collapse text-sm">
						<thead>
							<tr>
								{#each sheet.rows[0] ?? [] as cell, c (c)}
									<th
										class="sticky top-0 border-b bg-muted px-3 py-2 text-start font-medium whitespace-nowrap"
									>
										{cell}
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each sheet.rows.slice(1) as row, r (r)}
								<tr class="odd:bg-background even:bg-muted/30">
									{#each row as cell, c (c)}
										<td class="border-b px-3 py-1.5 whitespace-nowrap">{cell}</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				{/if}
			</div>

			{#if sheet.truncated}
				<p class="border-t bg-background px-3 py-2 text-xs text-muted-foreground">
					Showing the first {MAX_ROWS} rows.
				</p>
			{/if}
		</div>
	{/if}
{/if}
