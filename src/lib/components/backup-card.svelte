<!-- src/lib/components/BackupCard.svelte -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import { Progress } from '$lib/components/ui/progress';
	import { Separator } from '$lib/components/ui/separator';
	import { settings } from '$lib/store/settings.svelte';
	import { backup, type Phase } from '$lib/backup.svelte';
	import { listBuckets } from '$lib/buckets';
	import { rightsFromPolicy } from '$lib/policyRights';
	import policy from '$lib/backup-policy.json';

	let buckets = $state<string[]>([]);
	let loadingBuckets = $state(false);
	let bucketError = $state('');

	const s = $derived(settings.data);
	const locked = $derived(backup.running); // changing options needs a restart
	const canStart = $derived(!!s.backupFolder && !!s.backupBucket && !!s.s3Alias && !backup.running);
	const canDelete = rightsFromPolicy(policy).find((r) => r.key === 'delete')?.granted ?? false;

	async function loadBuckets() {
		loadingBuckets = true;
		bucketError = '';
		try {
			buckets = await listBuckets();
			if (buckets.length === 0) bucketError = 'No buckets found for this account.';
		} catch (e) {
			bucketError = e instanceof Error ? e.message : String(e);
		} finally {
			loadingBuckets = false;
		}
	}

	onMount(async () => {
		await settings.hydrated;
		void loadBuckets();
		void backup.init(); // tray + resume a backup that was running when the app closed
	});

	async function pickFolder() {
		const dir = await open({ directory: true, multiple: false, title: 'Choose a folder to back up' });
		if (typeof dir === 'string') await settings.set('backupFolder', dir);
	}

	function start() {
		void backup.start({
			folder: s.backupFolder,
			alias: s.s3Alias,
			bucket: s.backupBucket,
			watch: s.backupWatch,
			removeDeleted: s.backupRemoveDeleted && canDelete
		});
	}

	const phaseLabel: Record<Phase, string> = {
		idle: 'Not running',
		starting: 'Starting',
		syncing: 'Backing up',
		watching: 'Watching for changes',
		done: 'Backup complete',
		error: 'Error'
	};
	const phaseVariant: Record<Phase, 'default' | 'secondary' | 'outline' | 'destructive'> = {
		idle: 'outline',
		starting: 'outline',
		syncing: 'default',
		watching: 'secondary',
		done: 'secondary',
		error: 'destructive'
	};
	const kindVariant = { upload: 'secondary', remove: 'outline', error: 'destructive' } as const;
	const kindLabel = { upload: 'Uploaded', remove: 'Removed', error: 'Failed' } as const;

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

	function clock(at: number): string {
		return new Date(at).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}
</script>

<Card.Root class="bg-primary/5 md:col-span-2 lg:col-span-3">
	<Card.Header>
		<Card.Title>Folder backup</Card.Title>
		<Card.Description>Copy a folder to a bucket and keep it up to date</Card.Description>
	</Card.Header>

	<Card.Content class="grid gap-6 lg:grid-cols-2">
		<!-- Setup -->
		<div class="space-y-4">
			<div class="space-y-2">
				<Label>Folder</Label>
				<div class="flex items-center gap-2">
					<div
						class="min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2 font-mono text-xs"
						title={s.backupFolder}
					>
						{#if s.backupFolder}
							{s.backupFolder}
						{:else}
							<span class="text-muted-foreground">No folder selected</span>
						{/if}
					</div>
					<Button variant="outline" onclick={pickFolder} disabled={locked}>Choose folder</Button>
				</div>
			</div>

			<div class="space-y-2">
				<div class="flex items-center justify-between">
					<Label>Bucket</Label>
					<Button variant="ghost" size="sm" onclick={loadBuckets} disabled={loadingBuckets || locked}>
						{loadingBuckets ? 'Loading…' : 'Refresh'}
					</Button>
				</div>
				<Select.Root
					type="single"
					value={s.backupBucket}
					onValueChange={(v) => settings.set('backupBucket', v)}
					disabled={locked || buckets.length === 0}
				>
					<Select.Trigger class="w-full">
						{s.backupBucket || 'Choose a bucket'}
					</Select.Trigger>
					<Select.Content>
						{#each buckets as b (b)}
							<Select.Item value={b} label={b}>{b}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if !s.s3Alias}
					<p class="text-xs text-muted-foreground">Sign in to the storage server first.</p>
				{:else if bucketError}
					<p class="text-xs text-destructive">{bucketError}</p>
				{/if}
			</div>

			<Separator />

			<div class="space-y-3">
				<div class="flex items-center justify-between gap-4">
					<div>
						<Label for="backup-watch">Keep watching</Label>
						<p class="text-xs text-muted-foreground">
							After the first copy, upload new and changed files as they appear.
						</p>
					</div>
					<Switch
						id="backup-watch"
						checked={s.backupWatch}
						onCheckedChange={(v) => settings.set('backupWatch', v)}
						disabled={locked}
					/>
				</div>

				<div class="flex items-center justify-between gap-4">
					<div>
						<Label for="backup-remove">Mirror deletions</Label>
						<p class="text-xs text-muted-foreground">
							{canDelete
								? 'Also delete from the bucket what you delete here.'
								: 'This account is not allowed to delete files.'}
						</p>
					</div>
					<Switch
						id="backup-remove"
						checked={s.backupRemoveDeleted && canDelete}
						onCheckedChange={(v) => settings.set('backupRemoveDeleted', v)}
						disabled={locked || !canDelete}
					/>
				</div>
			</div>

			<div class="flex gap-2">
				{#if backup.running}
					<Button variant="destructive" onclick={() => backup.stop()}>Stop backup</Button>
				{:else}
					<Button onclick={start} disabled={!canStart}>
						{s.backupWatch ? 'Start and watch' : 'Back up now'}
					</Button>
				{/if}
			</div>
		</div>

		<!-- Status -->
		<div class="flex min-w-0 flex-col gap-4">
			<div class="flex items-center justify-between gap-3">
				<Badge variant={phaseVariant[backup.phase]}>{phaseLabel[backup.phase]}</Badge>
				{#if backup.destination}
					<span class="truncate font-mono text-xs text-muted-foreground" title={backup.destination}>
						{backup.destination}
					</span>
				{/if}
			</div>

			{#if backup.error}
				<p class="text-sm text-destructive">{backup.error}</p>
			{/if}

			{#if backup.phase === 'syncing' || backup.phase === 'done'}
				<div class="space-y-1.5">
					<Progress value={backup.phase === 'done' ? 100 : backup.percent} max={100} />
					<p class="text-xs text-muted-foreground">
						{backup.progress.files.toLocaleString()} of {backup.progress.totalFiles.toLocaleString()} files
						· {formatBytes(backup.progress.bytes)}
						{#if backup.progress.totalBytes}of {formatBytes(backup.progress.totalBytes)}{/if}
					</p>
				</div>
			{/if}

			<dl class="grid grid-cols-3 gap-2 text-sm">
				<div>
					<dt class="text-xs text-muted-foreground">Uploaded</dt>
					<dd class="font-medium">{backup.counts.uploaded.toLocaleString()}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground ">Removed</dt>
					<dd class="font-medium">{backup.counts.removed.toLocaleString()}</dd>
				</div>
				<div>
					<dt class="text-xs text-muted-foreground">Failed</dt>
					<dd class="font-medium" class:text-destructive={backup.counts.failed > 0}>
						{backup.counts.failed.toLocaleString()}
					</dd>
				</div>
			</dl>

			<Separator />

			<div class="min-h-0 flex-1">
				<p class="mb-2 text-sm font-medium">Changes</p>
				{#if backup.changes.length === 0}
					<p class="text-sm text-muted-foreground">
						{backup.running ? 'Waiting for files…' : 'Nothing yet. Start a backup to see changes here.'}
					</p>
				{:else}
					<ul class="max-h-56 space-y-2.5 overflow-y-auto pr-1">
						{#each backup.changes as c (c.id)}
							<li class="flex items-start justify-between gap-3 text-sm">
								<div class="min-w-0">
									<p class="truncate font-mono text-xs" title={c.path}>{c.path}</p>
									<p class="text-xs text-muted-foreground">
										{clock(c.at)}{#if c.size} · {formatBytes(c.size)}{/if}
									</p>
								</div>
								<Badge variant={kindVariant[c.kind]} class="shrink-0">{kindLabel[c.kind]}</Badge>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	</Card.Content>
</Card.Root>