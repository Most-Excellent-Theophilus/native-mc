<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import * as Card from "$lib/components/ui/card";
  import * as Avatar from "$lib/components/ui/avatar";
  import { Badge } from "$lib/components/ui/badge";
  import { Separator } from "$lib/components/ui/separator";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { settings } from "$lib/store/settings.svelte";
  import { loadOverview, type Overview } from "$lib/overview";
  import BackupCard from "$lib/components/backup-card.svelte";

  let overview = $state<Overview | null>(null);
  let loadError = $state("");

  onMount(async () => {
    try {
      overview = await loadOverview();
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    }
  });

  // Local settings are real, not sample data.
  const settingRows = $derived([
    { label: "Server IP", value: settings.data.serverIp },
    { label: "Storage endpoint", value: settings.data.s3Endpoint },
    { label: "Access key", value: settings.data.s3AccessKey },
    { label: "Alias", value: settings.data.s3Alias },
  ]);

  const initials = $derived(
    (overview?.user.name || "?").slice(0, 2).toUpperCase(),
  );

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.round(diff / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return `${d} d ago`;
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
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

  const statusVariant = {
    synced: "secondary",
    running: "outline",
    failed: "destructive",
  } as const;
</script>

<div class="flex flex-1 flex-col h-screen gap-4 p-4">
  {#if loadError}
    <Card.Root class="border-destructive/50">
      <Card.Header>
        <Card.Title class="text-destructive"
          >Couldn't load the overview</Card.Title
        >
        <Card.Description>{loadError}</Card.Description>
      </Card.Header>
    </Card.Root>
  {:else if !overview}
    <div class="grid auto-rows-min gap-4 md:grid-cols-3">
      {#each [0, 1, 2] as i (i)}
        <Skeleton class="h-48 rounded-xl" />
      {/each}
    </div>
    <div class="grid gap-4 lg:grid-cols-3">
      {#each [0, 1, 2] as i (i)}
        <Skeleton class="h-72 rounded-xl" />
      {/each}
    </div>
  {:else}
    <!-- {#if overview.source === "sample"}
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">Sample data</Badge>
        Role, rights, activity, deletions and mirrors are placeholders until the
        backend is connected.
      </div>
    {/if} -->

    <!-- Row 1: who you are, what you can do, how you're set up -->
    <div class="grid auto-rows-min gap-4 md:grid-cols-2 lg:grid-cols-3">
      <BackupCard />

      <!-- <Card.Root class="bg-primary/5">
        <Card.Header>
          <Card.Title>Profile</Card.Title>
          <Card.Description>Signed-in user</Card.Description>
        </Card.Header>
        <Card.Content class="space-y-4">
          <div class="flex items-center gap-3">
            <Avatar.Root class="size-12">
              <Avatar.Fallback class="font-medium">{initials}</Avatar.Fallback>
            </Avatar.Root>
            <div class="min-w-0">
              <p class="truncate font-medium">{overview.user.name}</p>
              <Badge
                variant={overview.user.role === "admin"
                  ? "default"
                  : "secondary"}
              >
                {overview.user.role === "admin" ? "Admin" : "User"}
              </Badge>
            </div>
          </div>
          <Separator />
          <dl class="grid grid-cols-2 gap-y-2 text-sm">
            <dt class="text-muted-foreground">Member since</dt>
            <dd class="text-right">{formatDate(overview.user.createdAt)}</dd>
            <dt class="text-muted-foreground">Last sign-in</dt>
            <dd class="text-right">{timeAgo(overview.user.lastLogin)}</dd>
          </dl>
        </Card.Content>
      </Card.Root>

      <Card.Root class="bg-primary/5">
        <Card.Header>
          <Card.Title>Settings</Card.Title>
          <Card.Description>Saved on this device</Card.Description>
        </Card.Header>
        <Card.Content>
          <dl class="space-y-3 text-sm">
            {#each settingRows as row (row.label)}
              <div class="flex flex-col gap-0.5">
                <dt class="text-xs text-muted-foreground">{row.label}</dt>
                <dd class="truncate font-mono text-xs">
                  {#if row.value}
                    {row.value}
                  {:else}
                    <span class="text-muted-foreground">Not set</span>
                  {/if}
                </dd>
              </div>
            {/each}
          </dl>
        </Card.Content>
      </Card.Root> -->
    </div>

    <!-- Row 2: what happened -->
    <!-- <div class="grid flex-1 gap-4 lg:grid-cols-3">
      <Card.Root class="flex bg-primary/5 flex-col">
        <Card.Header>
          <Card.Title>Recent actions</Card.Title>
          <Card.Description>Latest activity by this user</Card.Description>
        </Card.Header>
        <Card.Content class="flex-1 overflow-y-auto">
          {#if overview.activity.length === 0}
            <p class="text-sm text-muted-foreground">No activity yet.</p>
          {:else}
            <ul class="space-y-3">
              {#each overview.activity as a (a.id)}
                <li class="flex items-start justify-between gap-3 text-sm">
                  <div class="min-w-0">
                    <p class="font-medium capitalize">{a.action}</p>
                    <p class="truncate text-xs text-muted-foreground">
                      {a.target}
                    </p>
                  </div>
                  <span class="shrink-0 text-xs text-muted-foreground"
                    >{timeAgo(a.at)}</span
                  >
                </li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>

      <Card.Root class="flex flex-col bg-primary/5">
        <Card.Header>
          <Card.Title>Deleted files</Card.Title>
          <Card.Description>Including mirror copies</Card.Description>
        </Card.Header>
        <Card.Content class="flex-1 overflow-y-auto">
          {#if overview.deleted.length === 0}
            <p class="text-sm text-muted-foreground">Nothing deleted.</p>
          {:else}
            <ul class="space-y-3">
              {#each overview.deleted as f (f.id)}
                <li class="flex items-start justify-between gap-3 text-sm">
                  <div class="min-w-0">
                    <p class="truncate font-medium">{f.name}</p>
                    <p class="text-xs text-muted-foreground">
                      {formatBytes(f.size)} · {timeAgo(f.deletedAt)}
                    </p>
                  </div>
                  {#if f.isMirror}
                    <Badge variant="outline" class="shrink-0">Mirror</Badge>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>

      <Card.Root class="flex flex-col bg-primary/5">
        <Card.Header>
          <Card.Title>Mirrors</Card.Title>
          <Card.Description>Replication jobs overview</Card.Description>
        </Card.Header>
        <Card.Content class="flex-1 overflow-y-auto">
          {#if overview.mirrors.length === 0}
            <p class="text-sm text-muted-foreground">No mirrors configured.</p>
          {:else}
            <ul class="space-y-3">
              {#each overview.mirrors as m (m.id)}
                <li class="flex items-start justify-between gap-3 text-sm">
                  <div class="min-w-0">
                    <p class="truncate font-medium">{m.source} → {m.target}</p>
                    <p class="text-xs text-muted-foreground">
                      {m.files.toLocaleString()} files · {timeAgo(m.lastRun)}
                    </p>
                  </div>
                  <Badge
                    variant={statusVariant[m.status]}
                    class="shrink-0 capitalize"
                  >
                    {m.status}
                  </Badge>
                </li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>
    </div> -->
  {/if}
</div>
