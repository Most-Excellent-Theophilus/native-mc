<!-- src/lib/components/BackupCard.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import { ask, open } from "@tauri-apps/plugin-dialog";
  import * as Card from "$lib/components/ui/card";
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Switch } from "$lib/components/ui/switch";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Progress } from "$lib/components/ui/progress";
  import { Separator } from "$lib/components/ui/separator";
  import {Plus} from "@lucide/svelte"
  import {
    settings,
    type BackupSource,
    type BackupTarget,
  } from "$lib/store/settings.svelte";
  import {
    backup,
    canDelete,
    destinationFor,
    uniquePrefix,
    type Phase,
    type RestoreMode,
  } from "$lib/backup.svelte";
  import { Slider } from "$lib/components/ui/slider/index.js";

  const s = $derived(settings.data);
  const sources = $derived(s.backupSources);

  const targetLabel: Record<BackupTarget, string> = {
    personal: "Private",
    common: "Common",
  };
  const targetHint: Record<BackupTarget, string> = {
    personal: "Only you can see these files.",
    common: "Shared: saved in a folder with your username; everyone with access can see these files.",
  };

  // ---- add a folder ------------------------------------------------------
  let newFolder = $state("");
  let newTarget = $state<BackupTarget>("personal");
  let addError = $state("");

  async function pickFolder() {
    const dir = await open({
      directory: true,
      multiple: false,
      title: "Choose a folder to back up",
    });
    if (typeof dir === "string") {
      newFolder = dir;
      addError = "";
    }
  }

  async function addSource() {
    if (!newFolder) return;
    if (sources.some((x) => x.folder === newFolder && x.target === newTarget)) {
      addError = `This folder is already backed up to the ${targetLabel[newTarget].toLowerCase()} bucket.`;
      return;
    }
    const src: BackupSource = {
      id: crypto.randomUUID(),
      folder: newFolder,
      target: newTarget,
      prefix: uniquePrefix(newFolder, newTarget, sources),
    };
    await settings.set("backupSources", [...sources, src]);
    newFolder = "";
    addError = "";
  }

  async function removeSource(src: BackupSource) {
    const ok = await ask(
      `Stop backing up\n${src.folder}\n\nThe files already in the bucket are kept.`,
      {
        kind: "warning",
        title: "Remove folder",
        okLabel: "Remove",
        cancelLabel: "Cancel",
      },
    );
    if (!ok) return;
    await backup.forget(src.id);
    await settings.set(
      "backupSources",
      sources.filter((x) => x.id !== src.id),
    );
  }

  // ---- run / stop / restore ----------------------------------------------
  async function stopSource(src: BackupSource) {
    const ok = await ask(`Stop backing up\n${src.folder}?`, {
      kind: "warning",
      title: "Stop backup",
      okLabel: "Keep running",
      cancelLabel: "Stop",
    });
    if (!ok) void backup.stop(src.id);
  }

  async function restoreSource(src: BackupSource, mode: RestoreMode) {
    const text =
      mode === "missing"
        ? `Download the files that are in the backup but missing from\n${src.folder}\n\nFiles that exist now are not touched.`
        : `Make\n${src.folder}\nmatch the backup.\n\nMissing files are downloaded. Files that differ from the backup, including ones you edited since the last backup, are replaced by the backup version.\n\nUse this when the folder was lost.`;
    const ok = await ask(
      text +
        "\n\nThe backup of this folder pauses during the restore and continues afterwards.",
      {
        kind: "warning",
        title: mode === "missing" ? "Recover missing files" : "Full restore",
        okLabel: "Restore",
        cancelLabel: "Cancel",
      },
    );
    if (ok) void backup.restore(src, mode);
  }

  // ---- options shared by all folders --------------------------------------
  const canStartAll = $derived(sources.length > 0 && !!s.s3Alias);

  function setSettle(raw: string) {
    const n = Math.min(120, Math.max(0, Number(raw) || 0));
    void settings.set("backupSettleMinutes", n);
  }

  // Ticks so "next file in N min" counts down.
  let now = $state(Date.now());
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 10_000);
    return () => clearInterval(t);
  });

  function inMinutes(at: number): string {
    const ms = at - now;
    return ms < 60_000 ? "under a minute" : `${Math.ceil(ms / 60_000)} min`;
  }

  onMount(async () => {
    await settings.hydrated;
    void backup.init(); // subscribe to the engine (it, the tray and the resume all live in Rust)

    // Older versions had a single folder; keep it as the first entry of the list.
    const d = settings.data;
    if (d.backupFolder && d.backupSources.length === 0) {
      await settings.set("backupSources", [
        {
          id: crypto.randomUUID(),
          folder: d.backupFolder,
          target: "personal",
          prefix: uniquePrefix(d.backupFolder, "personal", []),
        },
      ]);
      await settings.set("backupFolder", "");
    }
  });

  // ---- display -------------------------------------------------------------
  const phaseLabel: Record<Phase, string> = {
    idle: "Not running",
    starting: "Starting",
    scanning: "Checking folder",
    syncing: "Backing up",
    restoring: "Restoring",
    watching: "Watching for changes",
    done: "Complete",
    error: "Error",
  };
  const phaseVariant: Record<
    Phase,
    "default" | "secondary" | "outline" | "destructive"
  > = {
    idle: "outline",
    starting: "outline",
    scanning: "outline",
    syncing: "default",
    restoring: "default",
    watching: "secondary",
    done: "secondary",
    error: "destructive",
  };
  const kindVariant = {
    upload: "secondary",
    remove: "outline",
    restore: "default",
    error: "destructive",
  } as const;
  const kindLabel = {
    upload: "Uploaded",
    remove: "Removed",
    restore: "Restored",
    error: "Failed",
  } as const;

  function folderName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    const units = ["KB", "MB", "GB", "TB"];
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
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  /** Recent changes of every folder, newest first, each tagged with its folder. */
  const activity = $derived(
    sources
      .flatMap((src) =>
        backup.of(src.id).changes.map((c) => ({
          ...c,
          key: `${src.id}-${c.id}`,
          folder: folderName(src.folder),
          target: src.target,
        })),
      )
      .sort((a, b) => b.at - a.at)
      .slice(0, 50),
  );
</script>

<Card.Root class="bg-primary/5  h-full overflow-y-auto">
  <Card.Header>
    <Card.Title>Folder backup</Card.Title>
    <Card.Description>
      Back up several folders, each to your private bucket or the common one,
      and bring files back when you need them
    </Card.Description>
  </Card.Header>

  <Card.Content class="grid gap-6 lg:grid-cols-2">
    <!-- Setup -->
    <div class="space-y-4">
     
 <!-- Add a folder -->
      <div class="space-y-2">
        <Label>Add a folder</Label>
        <div class="flex items-center gap-2">
          <div
            class="min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2 font-mono text-xs"
            title={newFolder}
          >
            {#if newFolder}
              {newFolder}
            {:else}
              <span class="text-muted-foreground">No folder selected</span>
            {/if}
          </div>
          <Button variant="outline" onclick={pickFolder}>Choose folder</Button>
        </div>
       
        <!-- <p class="text-xs text-muted-foreground">{targetHint[newTarget]}</p> -->
       
        {#if addError}
          <p class="text-xs text-destructive">{addError}</p>
        {/if}
      </div>
      <Separator />
      {#if backup.running}
        <p class="text-xs text-muted-foreground">
          Changes apply to folders you start next. Stop and start a running
          folder to apply them to it.
        </p>
        <Separator />
      {/if}

      <!-- Options shared by all folders -->
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-4">
          <div>
            <Label for="backup-settle">Wait before uploading (minutes)</Label>
            <p class="text-xs text-muted-foreground">
              A file is uploaded only after it has not changed for this long,
              counted from when it was last edited or added to the folder. 0
              uploads right away.
            </p>
          </div>
          <Input
            id="backup-settle"
            type="number"
            min="0.1"
            max="120"
            step="0.1"
            class="w-20 shrink-0"
            value={s.backupSettleMinutes}
            onchange={(e) => setSettle(e.currentTarget.value)}
          />
        </div>

        <Slider
          type="single"
          min={0.1}
          max={120}
          step={0.1}
          value={s.backupSettleMinutes}
          onValueChange={(e) => setSettle(e)}
        />
        <div class="flex items-center justify-between gap-4">
          <div>
            <Label for="backup-watch">Keep watching</Label>
            <p class="text-xs text-muted-foreground">
              After the first copy, keep checking and upload new and changed
              files. Temporary files (Office ~$ and .tmp files, partial
              downloads) are never uploaded.
            </p>
          </div>
          <Switch
            id="backup-watch"
            checked={s.backupWatch}
            onCheckedChange={(v) => settings.set("backupWatch", v)}
          />
        </div>

        <div class="flex items-center justify-between gap-4">
          <div>
            <Label for="backup-remove">Mirror deletions</Label>
            <p class="text-xs text-muted-foreground">
              {canDelete
                ? "Also delete from the bucket what you delete here, after the wait above. Recover deleted files before that time, or leave this off."
                : "This account is not allowed to delete files."}
            </p>
          </div>
          <Switch
            id="backup-remove"
            checked={s.backupRemoveDeleted && canDelete}
            onCheckedChange={(v) => settings.set("backupRemoveDeleted", v)}
            disabled={!canDelete}
          />
        </div>
      <Separator />
      
      <div class="space-y-2">
        <p class="text-xs text-muted-foreground">{targetHint[newTarget]}</p>
        
        <div class="flex items-center gap-2">
          <Select.Root
            type="single"
            value={newTarget}
            onValueChange={(v) => (newTarget = v as BackupTarget)}
          >
            <Select.Trigger class="w-full"
              >{targetLabel[newTarget]} bucket</Select.Trigger
            >
            <Select.Content>
              <Select.Item value="personal" label="Private bucket"
                >Private bucket</Select.Item
              >
              <Select.Item value="common" label="Common bucket"
                >Common bucket</Select.Item
              >
            </Select.Content>
          </Select.Root>
          <Button onclick={addSource} size='lg' disabled={!newFolder || !s.s3Alias}
            > <Plus />
            Add</Button
          >
        </div>
        {#if !s.s3Alias}
          <p class="text-xs text-muted-foreground">
            Sign in to the storage server first.
          </p>
        {/if}
        {#if addError}
          <p class="text-xs text-destructive">{addError}</p>
        {/if}
      </div>
      </div>
    </div>

    <!-- Activity -->
    <div class="flex min-w-0 flex-col gap-4">
      <dl class="grid grid-cols-4 gap-2 text-sm">
        <div>
          <dt class="text-xs text-muted-foreground">Uploaded</dt>
          <dd class="font-medium">{backup.counts.uploaded.toLocaleString()}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">Restored</dt>
          <dd class="font-medium">{backup.counts.restored.toLocaleString()}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">Removed</dt>
          <dd class="font-medium">{backup.counts.removed.toLocaleString()}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted-foreground">Failed</dt>
          <dd
            class="font-medium"
            class:text-destructive={backup.counts.failed > 0}
          >
            {backup.counts.failed.toLocaleString()}
          </dd>
        </div>
      </dl>

      <Separator />

      <!-- Folder list -->
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <Label>Folders ({sources.length})</Label>
          <div class="flex gap-2">
            <Button
              size="sm"
              onclick={() => backup.startAll()}
              disabled={!canStartAll}
            >
              {s.backupWatch ? "Start all and watch" : "Back up all now"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onclick={() => backup.stopAll()}
              disabled={!backup.running}
            >
              Stop all
            </Button>
          </div>
        </div>

        {#if sources.length === 0}
          <p class="text-sm text-muted-foreground">
            No folders yet. Choose one above and press Add.
          </p>
        {/if}

        {#each sources as src (src.id)}
          {@const st = backup.of(src.id)}
          {@const active = backup.isRunning(src.id)}
          {@const restoring = st.phase === "restoring"}
          <div class="space-y-2 rounded-md border bg-background p-3">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate font-mono text-xs" title={src.folder}>
                  {src.folder}
                </p>
                <p
                  class="truncate font-mono text-xs text-muted-foreground"
                  title={destinationFor(src)}
                >
                  {destinationFor(src)}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-1.5">
                <Badge variant="outline">{targetLabel[src.target]}</Badge>
                <Badge variant={phaseVariant[st.phase]}
                  >{phaseLabel[st.phase]}</Badge
                >
              </div>
            </div>

            {#if st.error}
              <p class="text-xs text-destructive">{st.error}</p>
            {/if}

            {#if st.phase === "syncing" || restoring}
              <div class="space-y-1">
                <Progress value={st.percent} max={100} />
                <p class="text-xs text-muted-foreground">
                  {st.percent}% · {st.filesDone.toLocaleString()} of {st.filesTotal.toLocaleString()}
                  files · {formatBytes(st.bytesDone)}
                  {#if st.bytesTotal}of {formatBytes(st.bytesTotal)}{/if}
                </p>
                {#if st.current.length}
                  <p
                    class="truncate font-mono text-xs text-muted-foreground"
                    title={st.current.join("\n")}
                  >
                    {restoring ? "Downloading" : "Uploading"}
                    {st.current[0]}{st.current.length > 1
                      ? ` +${st.current.length - 1} more`
                      : ""}
                  </p>
                {/if}
              </div>
            {:else if st.phase === "done" && st.restored > 0}
              <p class="text-xs text-muted-foreground">
                Restored {st.restored.toLocaleString()} file{st.restored === 1
                  ? ""
                  : "s"}.
              </p>
            {:else if st.phase === "done" && st.uploaded === 0 && st.filesTotal === 0}
              <p class="text-xs text-muted-foreground">
                Nothing to do: the folder already matches the backup.
              </p>
            {/if}

            {#if st.pending > 0 && (st.phase === "watching" || st.phase === "syncing" || st.phase === "done")}
              <p class="text-xs text-muted-foreground">
                {st.pending.toLocaleString()} file{st.pending === 1 ? "" : "s"} waiting
                for the
                {s.backupSettleMinutes} min quiet period
                {#if st.nextReadyAt}· next in {inMinutes(st.nextReadyAt)}{/if}
              </p>
            {/if}

            <div class="flex flex-wrap gap-2">
              {#if active && !restoring}
                <Button
                  size="sm"
                  variant="destructive"
                  onclick={() => stopSource(src)}>Stop</Button
                >
              {:else if !active}
                <Button
                  size="sm"
                  onclick={() => backup.start(src)}
                  disabled={!s.s3Alias}
                >
                  {s.backupWatch ? "Start and watch" : "Back up now"}
                </Button>
              {/if}
              <Button
                size="sm"
                variant="outline"
                onclick={() => restoreSource(src, "missing")}
                disabled={restoring || !s.s3Alias}
                title="Download files that are in the backup but missing from the folder"
              >
                Recover missing
              </Button>
              <Button
                size="sm"
                variant="outline"
                onclick={() => restoreSource(src, "full")}
                disabled={restoring || !s.s3Alias}
                title="Make the folder match the backup, for when it was lost"
              >
                Full restore
              </Button>
              {#if restoring}
                <Button
                  size="sm"
                  variant="destructive"
                  onclick={() => backup.stop(src.id)}
                >
                  Cancel restore
                </Button>
              {/if}
              <Button
                size="sm"
                variant="ghost"
                onclick={() => removeSource(src)}
                disabled={active}
                title={active ? "Stop it first" : "Remove from the list"}
              >
                Remove
              </Button>
            </div>
          </div>
        {/each}
      </div>

      <Separator />

      <div class="min-h-0 flex-1">
        <p class="mb-2 text-sm font-medium">Changes</p>
        {#if activity.length === 0}
          <p class="text-sm text-muted-foreground">
            {backup.running
              ? "Waiting for files…"
              : "Nothing yet. Start a backup to see changes here."}
          </p>
        {:else}
          <ul
            class="max-h-[65dvh] p-3 bg-accent space-y-2.5 overflow-y-auto pr-1"
          >
            {#each activity as c (c.key)}
              <li class="flex items-start justify-between gap-3 text-sm">
                <div class="min-w-0">
                  <p class="truncate font-mono text-xs" title={c.path}>
                    {c.path}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {c.folder} · {targetLabel[c.target]} · {clock(
                      c.at,
                    )}{#if c.size}
                      · {formatBytes(c.size)}{/if}
                  </p>
                </div>
                <Badge variant={kindVariant[c.kind]} class="shrink-0"
                  >{kindLabel[c.kind]}</Badge
                >
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </Card.Content>
</Card.Root>
