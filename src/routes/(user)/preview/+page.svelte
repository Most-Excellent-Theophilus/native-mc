<!-- src/routes/preview/+page.svelte -->
<!-- /preview?path=Screenshots/        -> folder contents -->
<!-- /preview?path=Screenshots/a.png   -> file preview     -->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { save } from "@tauri-apps/plugin-dialog";
  import { openPath } from "@tauri-apps/plugin-opener";
  import { readFile, remove } from "@tauri-apps/plugin-fs";
  import { onDestroy } from "svelte";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import DownloadIcon from "@lucide/svelte/icons/download";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import FileIcon from "@lucide/svelte/icons/file";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import Loader2Icon from "@lucide/svelte/icons/loader-2";
  import LayoutGridIcon from "@lucide/svelte/icons/layout-grid";
  import ListIcon from "@lucide/svelte/icons/list";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import * as Card from "$lib/components/ui/card";
  import FileGrid from "$lib/components/file-grid.svelte";
  // import FilePreview from '$lib/components/file/file-preview.svelte';
  import { settings } from "$lib/store/settings.svelte";
  import {
    listDir,
    statFile,
    fetchToCache,
    downloadTo,
    type Entry,
  } from "$lib/bucketFiles";
  import { ChevronLeft } from "@lucide/svelte";

  // page.url triggers the update; location.search is the always-current source in the webview.
  const path = $derived.by(() => {
    const fromKit = page.url.searchParams.get("path");
    if (fromKit !== null) return fromKit;
    return new URLSearchParams(window.location.search).get("path") ?? "";
  });
  const isFolder = $derived(path === "" || path.endsWith("/"));
  const bucket = $derived(settings.data.backupBucket);

  // breadcrumb: [{ label, path }]
  const crumbs = $derived.by(() => {
    const parts = path.split("/").filter(Boolean);
    const items = [{ label: bucket || "Bucket", path: "" }];
    parts.forEach((p, i) => {
      const isLast = i === parts.length - 1;
      items.push({
        label: p,
        path:
          parts.slice(0, i + 1).join("/") + (isLast && !isFolder ? "" : "/"),
      });
    });
    return items;
  });

  const fileName = $derived(path.split("/").filter(Boolean).pop() ?? "");

  let entries = $state<Entry[]>([]);
  let file = $state<{
    key: string;
    name: string;
    contentType: string;
    size: number;
  } | null>(null);
  let url = $state("");
  let loading = $state(false);
  let error = $state("");
  let note = $state("");
  let busy = $state(false);
  let tooBig = $state(false);
  let token = 0; // ignore results of an older navigation

  const MAX_PREVIEW_BYTES = 200 * 1024 * 1024; // bigger files: download or open externally

  function dropUrl() {
    if (url) URL.revokeObjectURL(url);
    url = "";
  }
  onDestroy(dropUrl);

  async function load() {
    const mine = ++token;
    const p = path;
    const folder = isFolder;
    bucket; // reload when the bucket changes
    loading = true;
    error = "";
    note = "";
    tooBig = false;
    dropUrl();
    file = null;
    entries = [];

    try {
      if (folder) {
        const list = await listDir(p);
        if (mine === token) entries = list;
      } else {
        const info = await statFile(p);
        if (mine !== token) return;
        file = {
          key: p,
          name: p.split("/").pop() ?? p,
          contentType: info.contentType,
          size: info.size,
        };
        if (info.size > MAX_PREVIEW_BYTES) {
          tooBig = true;
          return;
        }
        // Copy it with mc, read it, and hand the viewers a local blob: URL.
        const local = await fetchToCache(p);
        let bytes: Uint8Array;
        try {
          bytes = await readFile(local);
        } finally {
          await remove(local).catch(() => {});
        }
        if (mine !== token) return;
        url = URL.createObjectURL(
          new Blob([bytes as BlobPart], {
            type: info.contentType || "application/octet-stream",
          }),
        );
      }
    } catch (e) {
      if (mine === token) error = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === token) loading = false;
    }
  }

  $effect(() => {
    path;
    bucket;
    void load();
  });

  const go = (p: string) => goto(`/preview?path=${encodeURIComponent(p)}`);

  async function openExternally() {
    if (!file) return;
    note = "";
    busy = true;
    try {
      await openPath(await fetchToCache(file.key)); // opens in the default app
    } catch (e) {
      note = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function download() {
    if (!file) return;
    note = "";
    const dest = await save({ defaultPath: file.name, title: "Save file" });
    if (!dest) return;
    busy = true;
    try {
      await downloadTo(file.key, dest);
      note = `Saved to ${dest}`;
    } catch (e) {
      note = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
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
</script>

<div class="flex flex-1 flex-col gap-4 p-4">


  {#if !settings.data.s3Alias}
    <Card.Root class="bg-primary/5">
      <Card.Header>
        <Card.Title>Not signed in</Card.Title>
        <Card.Description
          >Sign in to the storage server to browse files.</Card.Description
        >
      </Card.Header>
    </Card.Root>
  {:else if !bucket}
    <Card.Root class="bg-primary/5">
      <Card.Header>
        <Card.Title>No bucket selected</Card.Title>
        <Card.Description
          >Choose a bucket in the backup card first.</Card.Description
        >
      </Card.Header>
    </Card.Root>
  {:else if isFolder}
    <!-- Folder -->
    <Card.Root class="bg-primary/5">
      <Card.Header>
        <Card.Title class="flex flex-wrap items-center gap-2 text-base">
          <span class="break-all">{path ? fileName : bucket}</span>
          {#if !loading && !error}
            <Badge variant="outline"
              >{entries.length} {entries.length === 1 ? "item" : "items"}</Badge
            >
          {/if}
        </Card.Title>
        <Card.Description>Select a folder or file to open it.</Card.Description>
      </Card.Header>
      <Card.Content>
        {#if loading}
          <div
            class="flex items-center gap-2 py-6 text-sm text-muted-foreground"
          >
            <Loader2Icon class="size-4 animate-spin" /> Reading the bucket…
          </div>
        {:else if error}
          <p class="py-4 text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onclick={load}>Retry</Button>
        {:else if entries.length === 0}
          <p class="py-4 text-sm text-muted-foreground">
            This folder is empty.
          </p>
        {:else}
          <div class="mb-3 flex gap-1 justify-between">
            <Button
              variant="outline"
              size="lg"
              onclick={() => {
                window.history.back();
              }}><ChevronLeft /> Back</Button
            >

            <div>
              <Button
                size="lg"
                variant={settings.data.viewMode === "grid"
                  ? "default"
                  : "ghost"}
                aria-pressed={settings.data.viewMode === "grid"}
                onclick={() => settings.set("viewMode", "grid")}
              >
                <LayoutGridIcon class="size-4" />
                <span class="sr-only">Grid view</span>
              </Button>
              <Button
                size="lg"
                variant={settings.data.viewMode === "list"
                  ? "default"
                  : "ghost"}
                aria-pressed={settings.data.viewMode === "list"}
                onclick={() => settings.set("viewMode", "list")}
              >
                <ListIcon class="size-4" />
                <span class="sr-only">List view</span>
              </Button>
            </div>
          </div>
          <FileGrid {entries} />
        {/if}
      </Card.Content>
    </Card.Root>
  {:else}
    <!-- File -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-lg font-medium break-all">{fileName}</h2>
        {#if file}
          <p class="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
        {/if}
      </div>
      <div class="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!file || busy}
          onclick={openExternally}
        >
          <ExternalLinkIcon class="size-4" /> Open externally
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!file || busy}
          onclick={download}
        >
          <DownloadIcon class="size-4" />
          {busy ? "Saving…" : "Download"}
        </Button>
      </div>
    </div>

    {#if note}<p class="text-xs text-muted-foreground break-all">{note}</p>{/if}

    <div class="h-[75svh] min-h-80 overflow-auto rounded-lg border bg-muted/40">
      {#if error && !file}
        <div
          class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <p class="text-sm text-muted-foreground">Couldn't open this file.</p>
          <p
            class="max-w-sm font-mono text-xs break-words text-muted-foreground/70"
          >
            {error}
          </p>
          <Button variant="outline" size="sm" onclick={load}>Retry</Button>
        </div>
      {:else if tooBig && file}
        <div
          class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
        >
          <p class="text-sm text-muted-foreground">
            This file is {formatBytes(file.size)}, too large to preview here.
          </p>
          <p class="text-xs text-muted-foreground">
            Use Download or Open externally.
          </p>
        </div>
      {:else}
        <!-- <FilePreview {file} {url} {loading} {error} onRetry={load} /> -->
      {/if}
    </div>
  {/if}
</div>
