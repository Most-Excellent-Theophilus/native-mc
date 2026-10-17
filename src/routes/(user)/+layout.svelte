<script lang="ts">
 
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import AppSidebar from "$lib/components/app-sidebar.svelte";
  import ThemeToggle from "$lib/components/theme-toggle.svelte";
  import UserButton from "$lib/components/user-button.svelte";
  import PathBreadCrumb from "$lib/components/path-bread-crumb.svelte";
  import SidebarToggle from "$lib/components/sidebar-toggle.svelte";
 
  import { settings } from "$lib/store/settings.svelte";
  import { goto } from "$app/navigation";
  
$effect(()=>{
  (async ()=> {
   void await settings.hydrated
   if(!settings.data.s3Alias){
    void await goto('/auth')
   }
    
  })()
})
 
  let { children } = $props();
</script>

<Sidebar.Provider>
  <AppSidebar />
  <Sidebar.Inset>
    <header
      class="flex h-16 shrink-0 items-center sticky  bg-secondary justify-between gap-2 border-b px-4"
    >
      <div class="flex items-center">
        <SidebarToggle />
        <Separator
          orientation="vertical"
          class="me-2 data-vertical:h-4 data-vertical:self-auto"
        />
        <PathBreadCrumb />
      </div>
      <div class="flex items-center space-x-1.5">
       
        <ThemeToggle />
        <UserButton />
      </div>
    </header>
    <div class="bg-accent h-[calc(100dvh-65px)]">
 
      {@render children?.()}
    </div>
  </Sidebar.Inset>
</Sidebar.Provider>
