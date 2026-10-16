<script lang="ts">
	interface Props {
		class?: string;
		color?: string;
		strokeColor?: string;
	}

	let {
		class: className = 'w-[105px] h-[105px]',
		color = '#118DB5',
		strokeColor = '#087EA4'
	}: Props = $props();
</script>

<svg class={className} viewBox="0 0 105 105" fill="none" xmlns="http://www.w3.org/2000/svg">
	<rect x="62" y="5" width="39" height="39" rx="6" fill={color} />
	<rect x="8" y="7" width="35" height="35" rx="17.5" fill={color} />
	<path
		d="M3 67C3 58.7157 9.71573 52 18 52H34C42.2843 52 49 58.7157 49 67V94C49 97.3137 46.3137 100 43 100H9C5.68629 100 3 97.3137 3 94V67Z"
		fill={color}
	/>
	<rect x="61" y="57" width="36" height="36" rx="8" fill={color} />
</svg>
