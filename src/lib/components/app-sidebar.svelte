<script lang="ts">
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import FileIcon from "@lucide/svelte/icons/file";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import { useSidebar } from "$lib/components/ui/sidebar/index.js";
  import type { ComponentProps } from "svelte";
  import { onMount, untrack } from "svelte";
  import { settings } from "$lib/store/settings.svelte";
  import { backup } from "$lib/backup.svelte";
  import { listDir, type Entry } from "$lib/bucketFiles";
  import { Folder, Home } from "@lucide/svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";

  type TreeNode = Entry & {
    children: TreeNode[] | null;
    loading: boolean;
    error: string;
  };

  let {
    ref = $bindable(null),
    ...restProps
  }: ComponentProps<typeof Sidebar.Root> = $props();

  const MIN_WIDTH = 200;
  const MAX_WIDTH = 560;
  const path = $derived.by(() => {
    const fromKit = page.url.searchParams.get("path");
    if (fromKit !== null) return fromKit;
    return new URLSearchParams(window.location.search).get("path") ?? "";
  });
  const sidebar = useSidebar();
  const dir = restProps.side === "right" ? -1 : 1;

  let handle = $state<HTMLElement | null>(null);
  let dragging = $state(false);
  let width = $state(settings.data.sidebarWidth);
  let drag = { startX: 0, startW: 0, moved: false };

  /** The Provider sets --sidebar-width inline; override it on that same element. */
  function applyWidth(px: number) {
    width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(px)));
    handle
      ?.closest<HTMLElement>('[style*="--sidebar-width"]')
      ?.style.setProperty("--sidebar-width", `${width}px`);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !handle) return;
    handle.setPointerCapture(e.pointerId);
    drag = {
      startX: e.clientX,
      startW:
        handle.closest('[data-sidebar="sidebar"]')?.getBoundingClientRect()
          .width ?? width,
      moved: false,
    };
    dragging = true;
    document.body.style.userSelect = "none";
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 3) drag.moved = true;
    if (drag.moved) applyWidth(drag.startW + dir * dx);
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = "";
    if (drag.moved) void settings.set("sidebarWidth", width);
    else sidebar.toggle(); // a plain click on the edge still collapses/expands, like the old rail
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    applyWidth(width + (e.key === "ArrowRight" ? 16 : -16) * dir);
    void settings.set("sidebarWidth", width);
  }

  onMount(async () => {
    await settings.hydrated;
    applyWidth(settings.data.sidebarWidth);
  });

  let root = $state<TreeNode[]>([]);
  let openFolderPath = $state<string | null>(null);
  let loading = $state(false);
  let rootError = $state("");

  const bucket = $derived(settings.data.backupBucket);
  const stateLabel = { upload: "U", remove: "D", error: "!" } as const;
  const open = (p: string) => goto(`/preview?path=${encodeURIComponent(p)}`);

  // Let long names wrap instead of being cut off with "…".
  const wrapBtn =
    "h-auto min-h-8 items-start py-1.5 flex items-center cursor-pointer";
  const wrapText = " truncate text-left";

  const toNode = (e: Entry): TreeNode => ({
    ...e,
    children: null,
    loading: false,
    error: "",
  });

  /** Fresh listing of a folder, keeping the sub-folders the user already opened. */
  async function reload(
    path: string,
    existing: TreeNode[] | null,
  ): Promise<TreeNode[]> {
    const entries = await listDir(path);
    return Promise.all(
      entries.map(async (e) => {
        const node = toNode(e);
        const old = existing?.find((n) => n.path === e.path);
        if (e.dir && old?.children)
          node.children = await reload(e.path, old.children);
        return node;
      }),
    );
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    rootError = "";
    try {
      root = await reload("", root);
    } catch (e) {
      rootError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function openFolder(node: TreeNode) {
    if (node.children !== null || node.loading) return;
    node.loading = true;
    node.error = "";
    try {
      node.children = (await listDir(node.path)).map(toNode);
    } catch (e) {
      node.error = e instanceof Error ? e.message : String(e);
    } finally {
      node.loading = false;
    }
  }

  // Reload when the bucket changes, and shortly after the backup uploads or removes files.
  $effect(() => {
    bucket;
    settings.data.s3Alias;
    backup.counts.uploaded;
    backup.counts.removed;
    backup.phase;
    const t = setTimeout(() => untrack(() => void refresh()), 2000);
    return () => clearTimeout(t);
  });

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

  const leaf = (path: string) =>
    path.split(/[\\/]/).filter(Boolean).pop() ?? path;
</script>

<Sidebar.Root bind:ref {...restProps}>
  <Sidebar.Content class='bg-primary/5'>
    <Sidebar.Group>
      <Sidebar.GroupLabel>Pages</Sidebar.GroupLabel>
      <Sidebar.GroupContent>
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton
              onclick={() => {
                goto("/");
              }}
              isActive={page.url.pathname == "/"}
              class="cursor-pointer"
            >
              <Home />
              <span>Home</span>
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton
              isActive={page.url.pathname == "/preview"}
              onclick={() => {
                goto("/preview");
              }}
              class="cursor-pointer"
            >
              <Folder />
              <span>Collections</span>
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.GroupContent>
    </Sidebar.Group>
    

    <Sidebar.Group>
      <Sidebar.GroupLabel
        >{bucket ? `Files in ${bucket}` : "Files"}</Sidebar.GroupLabel
      >
      <Sidebar.GroupAction title="Refresh" onclick={refresh}>
        <RefreshCwIcon class={loading ? "animate-spin" : ""} />
        <span class="sr-only">Refresh</span>
      </Sidebar.GroupAction>
      <Sidebar.GroupContent class='h-[30dvh] bg-accent outline overflow-y-auto'>
        <Sidebar.Menu>
          {#if !settings.data.s3Alias}
            <p class="p-2 text-xs text-muted-foreground">
              Sign in to see your files.
            </p>
          {:else if !bucket}
            <p class="p-2 text-xs text-muted-foreground">
              Choose a bucket in the backup card.
            </p>
          {:else if rootError}
            <p class="px-2 text-xs text-destructive">{rootError}</p>
          {:else if !loading && root.length === 0}
            <p class="p-2 text-xs text-muted-foreground">
              This bucket is empty.
            </p>
          {/if}
          {#each root as node (node.path)}
            {@render Tree({ node })}
          {/each}
        </Sidebar.Menu>
      </Sidebar.GroupContent>
    </Sidebar.Group>
    <Sidebar.Group>
      <Sidebar.GroupLabel>Changes</Sidebar.GroupLabel>
      <Sidebar.GroupContent class='h-[30dvh] bg-accent outline overflow-y-auto'>
        <Sidebar.Menu>
          {#each backup.changes.slice(0, 8) as c (c.id)}
            <Sidebar.MenuItem>
              <Sidebar.MenuButton title={c.path} class="{wrapBtn} pr-8">
                <FileIcon class="mt-0.5" />
                <span><span class={wrapText}>{leaf(c.path)}</span></span>
              </Sidebar.MenuButton>
              <Sidebar.MenuBadge>{stateLabel[c.kind]}</Sidebar.MenuBadge>
            </Sidebar.MenuItem>
          {:else}
            <p class="p-2 text-xs text-muted-foreground">No changes yet.</p>
          {/each}
        </Sidebar.Menu>
      </Sidebar.GroupContent>
    </Sidebar.Group>
  </Sidebar.Content>
  <!-- Drag to resize; click to collapse; arrow keys adjust when focused. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    bind:this={handle}
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar"
    aria-valuemin={MIN_WIDTH}
    aria-valuemax={MAX_WIDTH}
    aria-valuenow={width}
    tabindex="0"
    class="absolute inset-y-0 z-30 w-2 cursor-col-resize touch-none transition-colors hover:bg-sidebar-border focus-visible:bg-sidebar-ring {dir ===
    1
      ? '-right-1'
      : '-left-1'} {dragging ? 'bg-sidebar-ring' : ''}"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onkeydown={onKeyDown}
  ></div>
</Sidebar.Root>

<svelte:head>
  {#if dragging}
    <!-- No width animation while dragging, so the edge follows the pointer. -->
    <style>
      [data-slot="sidebar-gap"],
      [data-slot="sidebar-container"] {
        transition: none !important;
      }
    </style>
  {/if}
</svelte:head>

{#snippet Tree({ node }: { node: TreeNode })}
  {#if !node.dir}
    <Sidebar.MenuItem>
      <Sidebar.MenuButton
        title={node.path}
        onclick={() => open(node.path)}
        isActive={node.path == path}
        class="{wrapBtn} pr-16"
      >
        <FileIcon class="mt-0.5" />
        <span><span class={wrapText}>{node.name}</span></span>
      </Sidebar.MenuButton>
      <Sidebar.MenuBadge class="font-normal"
        >{formatBytes(node.size)}</Sidebar.MenuBadge
      >
    </Sidebar.MenuItem>
  {:else}
    <Sidebar.MenuItem>
      <Collapsible.Root
        class="group/collapsible  [&[data-state=open]>button>svg:first-child]:rotate-90"
        onOpenChange={(open) => open && openFolder(node)}
      >
        <Collapsible.Trigger>
          {#snippet child({ props })}
            <Sidebar.MenuButton
              {...props}
              class={wrapBtn}
              isActive={node.path == path}
            >
              <ChevronRightIcon class="mt-0.5 transition-transform" />
              <!-- <FolderIcon class="mt-0.5" /> -->
              <span><span class={wrapText}>{node.name}</span></span>
            </Sidebar.MenuButton>
          {/snippet}
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Sidebar.MenuSub>
            {#if node.loading}
              <p class="px-2 py-1 text-xs text-muted-foreground">Loading…</p>
            {:else if node.error}
              <p class="px-2 py-1 text-xs text-destructive">{node.error}</p>
            {:else if node.children?.length === 0}
              <p class="px-2 py-1 text-xs text-muted-foreground">
                Empty folder
              </p>
            {/if}
            {#each node.children ?? [] as child (child.path)}
              {@render Tree({ node: child })}
            {/each}
          </Sidebar.MenuSub>
        </Collapsible.Content>
      </Collapsible.Root>
    </Sidebar.MenuItem>
  {/if}
{/snippet}
