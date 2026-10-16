<script>
  import { cn } from "cn";
  import Logo from "./logo.svelte";
  import { useSidebar } from "./ui/sidebar";
  const sidebar = useSidebar();
</script>

<button class='p-1 cursor-pointer hover:bg-primary-foreground/5'  onclick={sidebar.toggle}>
  <Logo  class={cn('size-7 ', !sidebar.open &&' fill-accent')}/>
</button>
