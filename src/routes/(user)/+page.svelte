<!-- src/routes/+page.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import * as Card from "$lib/components/ui/card";
  import { Skeleton } from "$lib/components/ui/skeleton";
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





</script>

<div class="flex flex-1 flex-col h-full  gap-4 p-4">
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
  

      <BackupCard />


  {/if}
</div>
