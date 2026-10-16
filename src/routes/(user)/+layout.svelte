<script lang="ts">
  import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import AppSidebar from "$lib/components/app-sidebar.svelte";
  import ThemeToggle from "$lib/components/theme-toggle.svelte";
  import UserButton from "$lib/components/user-button.svelte";

  let { children } = $props();
</script>

<Sidebar.Provider>
  <AppSidebar />
  <Sidebar.Inset>
    <header
      class="flex h-16 shrink-0 items-center sticky top-0 z-50 bg-secondary justify-between gap-2 border-b px-4"
    >
      <div class="flex items-center">
        <Sidebar.Trigger class="-ms-1" />
        <Separator
          orientation="vertical"
          class="me-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <Breadcrumb.Root>
          <Breadcrumb.List>
            <Breadcrumb.Item class="hidden md:block">
              <Breadcrumb.Link href="##">lib</Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator class="hidden md:block" />
            <Breadcrumb.Item class="hidden md:block">
              <Breadcrumb.Link href="##">components</Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator class="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>button.svelte</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb.Root>
      </div>
      <div class="flex items-center space-x-1.5">

        <ThemeToggle />
        <UserButton />
      </div>
    </header>
    <div class='bg-accent'>

      {@render children?.()}
    </div>
  </Sidebar.Inset>
</Sidebar.Provider>
