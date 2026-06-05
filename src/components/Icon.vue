<script setup lang="ts">
import { computed } from 'vue'

defineProps<{
  name: string
  size?: number | string
  stroke?: number | string
}>()
</script>

<template>
  <svg
    :width="size ?? 16"
    :height="size ?? 16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke ?? 1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- add: plus in circle -->
    <template v-if="name === 'add'">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </template>
    <!-- minus -->
    <template v-else-if="name === 'minus'">
      <circle cx="12" cy="12" r="9" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </template>
    <!-- delete: trash -->
    <template v-else-if="name === 'delete'">
      <polyline points="4 7 20 7" />
      <path d="M9 7 V5 a1 1 0 0 1 1 -1 h4 a1 1 0 0 1 1 1 V7" />
      <path d="M6 7 l1 12 a1 1 0 0 0 1 1 h8 a1 1 0 0 0 1 -1 l1 -12" />
      <line x1="10" y1="11" x2="10" y2="18" />
      <line x1="14" y1="11" x2="14" y2="18" />
    </template>
    <!-- edit: pencil -->
    <template v-else-if="name === 'edit'">
      <path d="M4 20 l4 -1 11 -11 -3 -3 -11 11 z" />
      <line x1="14" y1="6" x2="18" y2="10" />
    </template>
    <!-- collapse: chevron up/down (rotate via :transform) -->
    <template v-else-if="name === 'collapse'">
      <polyline points="6 9 12 15 18 9" />
    </template>
    <!-- expand: chevron right -->
    <template v-else-if="name === 'expand'">
      <polyline points="9 6 15 12 9 18" />
    </template>
    <!-- zoom in -->
    <template v-else-if="name === 'zoom-in'">
      <circle cx="11" cy="11" r="7" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
      <line x1="16" y1="16" x2="21" y2="21" />
    </template>
    <!-- zoom out -->
    <template v-else-if="name === 'zoom-out'">
      <circle cx="11" cy="11" r="7" />
      <line x1="8" y1="11" x2="14" y2="11" />
      <line x1="16" y1="16" x2="21" y2="21" />
    </template>
    <!-- reset: target -->
    <template v-else-if="name === 'reset'">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </template>
    <!-- mindmap logo: branched node -->
    <template v-else-if="name === 'logo'">
      <circle cx="12" cy="12" r="2.2" />
      <circle cx="4" cy="5" r="1.6" />
      <circle cx="20" cy="5" r="1.6" />
      <circle cx="4" cy="19" r="1.6" />
      <circle cx="20" cy="19" r="1.6" />
      <line x1="10.5" y1="10.8" x2="5.2" y2="6.4" />
      <line x1="13.5" y1="10.8" x2="18.8" y2="6.4" />
      <line x1="10.5" y1="13.2" x2="5.2" y2="17.6" />
      <line x1="13.5" y1="13.2" x2="18.8" y2="17.6" />
    </template>
  </svg>
</template>
